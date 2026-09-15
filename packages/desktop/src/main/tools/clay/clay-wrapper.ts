/**
 * clay-wrapper — Clay 布局引擎的同构 TS 绑定（clay-ui-runtime WP1）。
 *
 * 零 Node API：wasm 字节与 measureText 均由调用方注入，浏览器与 Node 同构可载
 * （spec EARS 4）。元素树经 vendored clay-bindings.c 的扁平 setter 协议写入
 * （结构体偏移由 C 编译器计算，不在此层手排）；命令数组按 vendored clay.h 的
 * Clay_RenderCommand 布局读取（stride 72，偏移见 CMD_OFFSETS）。
 *
 * 断行职责（WP0 结论）：Clay 分词只认 ' ' 与 '\n'，CJK 文本由调用方
 * （WP2 编译器）逐字符度量预断行后再传入——本层不做断行。
 */

const CMD_NAMES = [
  "NONE",
  "RECTANGLE",
  "BORDER",
  "TEXT",
  "IMAGE",
  "SCISSOR_START",
  "SCISSOR_END",
  "CUSTOM",
  "OVERLAY_START",
  "OVERLAY_END",
] as const;

/** Clay_RenderCommand 布局常量（wasm32；vendored clay.h，stride 72 含尾填充）。 */
const OFFSET = { RENDER_DATA: 16, ID: 64, TYPE: 70, STRIDE: 72 };
/** heapBase 起的内存分区：scratch(12B) | pad | arena(MinMemorySize) | pad | 文本区(1MB)。 */
const ARENA_OFFSET = 4096;
const TEXT_REGION_PAD = 4096;
const TEXT_REGION_CAPACITY = 1024 * 1024;

const SIZING_TYPE = { fit: 0, grow: 1, fixed: 2, percent: 3 } as const;
const DIRECTION = { LTR: 0, TTB: 1 } as const;
const WRAP_MODE = { words: 0, newlines: 1, none: 2 } as const;

export interface ClayMeasureText {
  (text: string, fontId: number, fontSize: number): { width: number; height: number };
}

export interface ClaySizingAxisInit {
  type: "fit" | "grow" | "fixed" | "percent";
  value?: number;
}

export interface ClayLayoutInit {
  direction?: "LTR" | "TTB";
  padding?: [number, number, number, number];
  childGap?: number;
  sizing?: { width?: ClaySizingAxisInit; height?: ClaySizingAxisInit };
  childAlignment?: { x?: number; y?: number };
}

export interface ClayElementDeclarationInit {
  layout?: ClayLayoutInit;
  backgroundColor?: [number, number, number, number];
  cornerRadius?: [number, number, number, number];
  border?: { color: [number, number, number, number]; width: [number, number, number, number] };
}

export interface ClayTextInit {
  fontSize: number;
  color: [number, number, number, number];
  fontId?: number;
  lineHeight?: number;
  wrapMode?: keyof typeof WRAP_MODE;
}

export interface ClayCommandView {
  /** CMD_NAMES 之一（NONE、RECTANGLE、BORDER、TEXT、IMAGE、SCISSOR_START、SCISSOR_END、CUSTOM、OVERLAY_START、OVERLAY_END）。 */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  id: number;
  /** TEXT：UTF-8 解码后的文本内容。 */
  text?: string;
  /** TEXT/BORDER：前景色 rgba() 串；RECTANGLE/CUSTOM：背景 rgba() 串。 */
  color?: string;
  background?: string;
  radius?: [number, number, number, number];
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  fontId?: number;
}

/** vendored clay-bindings.c 编译产物的导出面（见 scripts/vendor/clay-bindings.c）。 */
interface ClayExports {
  memory: WebAssembly.Memory;
  __heap_base: WebAssembly.Global;
  Clay_MinMemorySize(): number;
  bind_init(heapBase: number, width: number, height: number): void;
  bind_decl_reset(): void;
  bind_set_background(r: number, g: number, b: number, a: number): void;
  bind_set_corner_radius(tl: number, tr: number, bl: number, br: number): void;
  bind_set_border(
    r: number,
    g: number,
    b: number,
    a: number,
    left: number,
    right: number,
    top: number,
    bottom: number
  ): void;
  bind_set_layout(
    direction: number,
    padL: number,
    padR: number,
    padT: number,
    padB: number,
    gap: number,
    wType: number,
    w: number,
    hType: number,
    h: number,
    alignX: number,
    alignY: number
  ): void;
  bind_open(): void;
  bind_close(): void;
  bind_text(
    charsPtr: number,
    length: number,
    fontSize: number,
    fontId: number,
    lineHeight: number,
    r: number,
    g: number,
    b: number,
    a: number,
    wrapMode: number
  ): void;
  bind_begin(width: number, height: number): void;
  bind_end(): number;
}

export interface ClayLayoutRuntimeOptions {
  /** vendored clay.wasm 的字节（调用方读取，本模块零 Node API）。 */
  wasm: Uint8Array;
  width: number;
  height: number;
  /** fontId → CSS font-family 串（浏览器渲染用；Node 测试可给占位串）。 */
  fonts: string[];
  /** 文本度量注入（浏览器=canvas measureText 桥；Node 测试=确定性桩）。 */
  measureText: ClayMeasureText;
}

export class ClayLayoutRuntime {
  private instance!: WebAssembly.Instance & { exports: ClayExports };
  private memory!: DataView;
  private textEncoder = new TextEncoder();
  private textBase = 0;
  private textBump = 0;
  private frameWidth = 1280;
  private frameHeight = 800;
  private readonly imports: WebAssembly.Imports;

  private constructor(
    private readonly fonts: string[],
    private readonly measureText: ClayMeasureText
  ) {
    this.imports = {
      clay: {
        // Clay__MeasureText import（-DCLAY_WASM）：outPtr 写 Dimensions，
        // textAddress 指 Clay_StringSlice（len u32 + chars u32 + base u32），
        // configAddress 指 Clay_TextElementConfig（fontId@20、fontSize@22）。
        measureTextFunction: (outAddress: number, textAddress: number, configAddress: number) => {
          const length = this.memory.getUint32(textAddress, true);
          const pointer = this.memory.getUint32(textAddress + 4, true);
          const text = this.readText(pointer, length);
          const fontId = this.memory.getUint16(configAddress + 20, true);
          const fontSize = this.memory.getUint16(configAddress + 22, true);
          const dimensions = measureText(text, fontId, fontSize);
          this.memory.setFloat32(outAddress, dimensions.width, true);
          this.memory.setFloat32(outAddress + 4, dimensions.height, true);
        },
        queryScrollOffsetFunction: () => [0, 0],
      },
    };
  }

  static create(options: ClayLayoutRuntimeOptions): ClayLayoutRuntime {
    const runtime = new ClayLayoutRuntime(options.fonts, options.measureText);
    // 同步实例化：100KB 级模块主线程编译无碍，且避免 async instantiate 在
    // Node 退出时遗留句柄（libuv async.c 断言，WP1 测试实测）。
    const bytes = new Uint8Array(options.wasm.byteLength);
    bytes.set(options.wasm);
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module, runtime.imports);
    runtime.instance = instance as unknown as WebAssembly.Instance & { exports: ClayExports };
    runtime.memory = new DataView(runtime.instance.exports.memory.buffer);
    const heapBase = (instance.exports.__heap_base as WebAssembly.Global).value;
    const minMemory = (instance.exports.Clay_MinMemorySize as () => number)();
    runtime.textBase = heapBase + ARENA_OFFSET + minMemory + TEXT_REGION_PAD;
    runtime.instance.exports.bind_init(heapBase, options.width, options.height);
    return runtime;
  }

  setFrameSize(width: number, height: number): void {
    this.frameWidth = width;
    this.frameHeight = height;
  }

  frameSize(): { width: number; height: number } {
    return { width: this.frameWidth, height: this.frameHeight };
  }

  beginFrame(): void {
    this.textBump = 0;
    this.instance.exports.bind_begin(this.frameWidth, this.frameHeight);
  }

  endFrame(): ClayCommandView[] {
    this.instance.exports.bind_end();
    return this.readCommands();
  }

  frame(build: () => void): ClayCommandView[] {
    this.beginFrame();
    build();
    return this.endFrame();
  }

  resetDeclaration(): void {
    this.instance.exports.bind_decl_reset();
  }

  setBackground(r: number, g: number, b: number, a: number): void {
    this.instance.exports.bind_set_background(r, g, b, a);
  }

  setCornerRadius(tl: number, tr: number, bl: number, br: number): void {
    this.instance.exports.bind_set_corner_radius(tl, tr, bl, br);
  }

  setBorder(color: [number, number, number, number], width: [number, number, number, number]): void {
    this.instance.exports.bind_set_border(
      color[0],
      color[1],
      color[2],
      color[3],
      width[0],
      width[1],
      width[2],
      width[3]
    );
  }

  setLayout(init: ClayLayoutInit = {}): void {
    const padding = init.padding ?? [0, 0, 0, 0];
    const w = init.sizing?.width ?? { type: "fit" as const };
    const h = init.sizing?.height ?? { type: "fit" as const };
    this.instance.exports.bind_set_layout(
      DIRECTION[init.direction ?? "TTB"],
      padding[0],
      padding[1],
      padding[2],
      padding[3],
      init.childGap ?? 0,
      SIZING_TYPE[w.type],
      w.value ?? 0,
      SIZING_TYPE[h.type],
      h.value ?? 0,
      init.childAlignment?.x ?? 0,
      init.childAlignment?.y ?? 0
    );
  }

  open(init?: ClayElementDeclarationInit): void {
    this.resetDeclaration();
    if (init?.layout) this.setLayout(init.layout);
    if (init?.backgroundColor) this.setBackground(...init.backgroundColor);
    if (init?.cornerRadius) this.setCornerRadius(...init.cornerRadius);
    if (init?.border) this.setBorder(init.border.color, init.border.width);
    this.instance.exports.bind_open();
  }

  close(): void {
    this.instance.exports.bind_close();
  }

  text(text: string, init: ClayTextInit): void {
    const encoded = this.textEncoder.encode(text);
    const pointer = this.textBase + this.textBump;
    if (this.textBump + encoded.length > TEXT_REGION_CAPACITY) {
      throw new Error(`clay-wrapper: text region exceeded ${TEXT_REGION_CAPACITY} bytes in one frame`);
    }
    new Uint8Array(this.memory.buffer).set(encoded, pointer);
    this.textBump += encoded.length;
    const color = init.color;
    this.instance.exports.bind_text(
      pointer,
      encoded.length,
      init.fontSize,
      init.fontId ?? 0,
      init.lineHeight ?? init.fontSize,
      color[0],
      color[1],
      color[2],
      color[3],
      WRAP_MODE[init.wrapMode ?? "words"]
    );
  }

  private readText(pointer: number, length: number): string {
    const bytes = new Uint8Array(this.memory.buffer.slice(pointer, pointer + length));
    return new TextDecoder("utf-8").decode(bytes);
  }

  private rgba(f32Offset: number): string {
    const r = Math.round(this.memory.getFloat32(f32Offset, true));
    const g = Math.round(this.memory.getFloat32(f32Offset + 4, true));
    const b = Math.round(this.memory.getFloat32(f32Offset + 8, true));
    const a = this.memory.getFloat32(f32Offset + 12, true) / 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  private readCommands(): ClayCommandView[] {
    const scratch = (this.instance.exports.__heap_base as WebAssembly.Global).value;
    const base = scratch;
    const length = this.memory.getUint32(base + 4, true);
    let arrayOffset = this.memory.getUint32(base + 8, true);
    const commands: ClayCommandView[] = [];
    for (let i = 0; i < length; i++, arrayOffset += OFFSET.STRIDE) {
      const typeIndex = this.memory.getUint8(arrayOffset + OFFSET.TYPE);
      const type = CMD_NAMES[typeIndex] ?? "NONE";
      const x = this.memory.getFloat32(arrayOffset, true);
      const y = this.memory.getFloat32(arrayOffset + 4, true);
      const width = this.memory.getFloat32(arrayOffset + 8, true);
      const height = this.memory.getFloat32(arrayOffset + 12, true);
      const id = this.memory.getUint32(arrayOffset + OFFSET.ID, true);
      const rd = arrayOffset + OFFSET.RENDER_DATA;
      const command: ClayCommandView = { type, x, y, width, height, id };
      if (type === "RECTANGLE") {
        command.background = this.rgba(rd);
        command.radius = [
          this.memory.getFloat32(rd + 16, true),
          this.memory.getFloat32(rd + 20, true),
          this.memory.getFloat32(rd + 24, true),
          this.memory.getFloat32(rd + 28, true),
        ];
      } else if (type === "BORDER") {
        command.color = this.rgba(rd);
        command.radius = [
          this.memory.getFloat32(rd + 16, true),
          this.memory.getFloat32(rd + 20, true),
          this.memory.getFloat32(rd + 24, true),
          this.memory.getFloat32(rd + 28, true),
        ];
      } else if (type === "TEXT") {
        const len = this.memory.getUint32(rd, true);
        const charsPtr = this.memory.getUint32(rd + 4, true);
        const fontId = this.memory.getUint16(rd + 28, true);
        command.text = this.readText(charsPtr, len);
        command.color = this.rgba(rd + 12);
        command.fontId = fontId;
        command.fontSize = this.memory.getUint16(rd + 30, true);
        command.lineHeight = this.memory.getUint16(rd + 34, true);
        command.fontFamily = this.fonts[fontId] ?? "sans-serif";
      }
      commands.push(command);
    }
    return commands;
  }
}
