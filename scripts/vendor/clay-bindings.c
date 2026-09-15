// clay-bindings.c — clay-ui-runtime WP1 数据驱动绑定层（scratch→vendor 的 C 侧 shim）。
//
// 为什么要有这层：Clay 的元素声明（Clay_ElementDeclaration）是几十字段的大结构体，
// 从 JS 直接按值传参/手排偏移既脆弱又随上游漂移。这里把它拆成一组扁平 setter
// （重置 → 逐项设置 → open），结构体偏移交给 C 编译器计算；TS wrapper 只说
// "reset / set_background / set_layout / open / text / close" 这层协议。
//
// 内存布局（heapBase 由 JS 传入，均为线性内存偏移）：
//   heapBase + 0        .. +12   bind_end 写回的命令三元组 (capacity, length, ptr)
//   heapBase + 4096     ..       Clay arena（容量 = Clay_MinMemorySize()，运行时查询）
//   heapBase + 4096 + M ..       JS 文本区（wrapper 管理，每帧重置；M = MinMemorySize）
//
// freestanding：-fno-builtin -nostdlib，需要的 libc 原语在本文件尾部自行提供。

#define CLAY_IMPLEMENTATION
// 注意：本文件不单独 #include clay.h——vendor-clay.js 会把它追加到
// clay-impl.c（CLAY_IMPLEMENTATION + clay-patched.h）之后，同一编译单元。
#include <stdint.h>

static void *bind_scratch = 0;
static Clay_ElementDeclaration bind_pending;

static Clay_SizingAxis bind_sizing(uint8_t type, float value) {
    switch (type) {
        case 1: return CLAY_SIZING_GROW(value);
        case 2: return CLAY_SIZING_FIXED(value);
        case 3: return CLAY_SIZING_PERCENT(value);
        default: return CLAY_SIZING_FIT(value);
    }
}

__attribute__((export_name("bind_init")))
void bind_init(uint32_t heapBase, float width, float height) {
    bind_scratch = (void *)(uintptr_t)heapBase;
    void *arenaMemory = (void *)(uintptr_t)(heapBase + 4096);
    Clay_Arena arena = Clay_CreateArenaWithCapacityAndMemory(Clay_MinMemorySize(), arenaMemory);
    Clay_Initialize(arena, CLAY__INIT(Clay_Dimensions) { .width = width, .height = height }, (Clay_ErrorHandler){0});
}

__attribute__((export_name("bind_decl_reset")))
void bind_decl_reset(void) {
    bind_pending = CLAY__INIT(Clay_ElementDeclaration) { 0 };
}

__attribute__((export_name("bind_set_background")))
void bind_set_background(float r, float g, float b, float a) {
    bind_pending.backgroundColor = CLAY__INIT(Clay_Color) { r, g, b, a };
}

__attribute__((export_name("bind_set_corner_radius")))
void bind_set_corner_radius(float tl, float tr, float bl, float br) {
    bind_pending.cornerRadius = CLAY__INIT(Clay_CornerRadius) { tl, tr, bl, br };
}

__attribute__((export_name("bind_set_border")))
void bind_set_border(float r, float g, float b, float a,
                     uint16_t left, uint16_t right, uint16_t top, uint16_t bottom) {
    bind_pending.border = CLAY__INIT(Clay_BorderElementConfig) {
        .color = { r, g, b, a },
        .width = { left, right, top, bottom, 0 },
    };
}

// sizingType: 0 = FIT(value 为最小值) · 1 = GROW(最小值) · 2 = FIXED · 3 = PERCENT
// alignX/alignY: Clay_ChildAlignment 枚举数值（0..5），默认 0 = 无对齐
__attribute__((export_name("bind_set_layout")))
void bind_set_layout(uint8_t direction,
                     uint16_t padL, uint16_t padR, uint16_t padT, uint16_t padB, uint16_t gap,
                     uint8_t wType, float w, uint8_t hType, float h,
                     uint8_t alignX, uint8_t alignY) {
    bind_pending.layout = CLAY__INIT(Clay_LayoutConfig) {
        .layoutDirection = (Clay_LayoutDirection)direction,
        .padding = { padL, padR, padT, padB },
        .childGap = gap,
        .sizing = { .width = bind_sizing(wType, w), .height = bind_sizing(hType, h) },
        .childAlignment = { alignX, alignY },
    };
}

__attribute__((export_name("bind_open")))
void bind_open(void) {
    Clay__OpenElement();
    Clay__ConfigureOpenElementPtr(&bind_pending);
}

// 绝对定位（leafer x/y）→ Clay floating（相对父容器偏移，不占流式布局位）。
__attribute__((export_name("bind_set_floating")))
void bind_set_floating(float offsetX, float offsetY) {
    bind_pending.floating = CLAY__INIT(Clay_FloatingElementConfig) {
        .attachTo = CLAY_ATTACH_TO_PARENT,
        .offset = { offsetX, offsetY },
    };
}

__attribute__((export_name("bind_close")))
void bind_close(void) {
    Clay__CloseElement();
}

// wrapMode: 0 = WORDS（默认，按空白分词）· 1 = NONE · 2 = NEWLINES
__attribute__((export_name("bind_text")))
void bind_text(uint32_t charsPtr, uint32_t length,
               float fontSize, uint16_t fontId, uint16_t lineHeight,
               float r, float g, float b, float a, uint8_t wrapMode) {
    Clay__OpenTextElement(
        CLAY__INIT(Clay_String) { .isStaticallyAllocated = false, .length = (int)length, .chars = (const char *)(uintptr_t)charsPtr },
        CLAY__INIT(Clay_TextElementConfig) {
            .fontId = fontId,
            .fontSize = (uint16_t)fontSize,
            .lineHeight = lineHeight,
            .textColor = { r, g, b, a },
            .wrapMode = (Clay_TextElementConfigWrapMode)wrapMode,
        });
}

__attribute__((export_name("bind_begin")))
void bind_begin(float width, float height) {
    Clay_SetLayoutDimensions(CLAY__INIT(Clay_Dimensions) { .width = width, .height = height });
    Clay_BeginLayout();
}

// 命令三元组写回 scratch（capacity, length, internalArray 指针）；返回 length。
__attribute__((export_name("bind_end")))
uint32_t bind_end(void) {
    Clay_RenderCommandArray commands = Clay_EndLayout(0.0f);
    uint32_t *out = (uint32_t *)bind_scratch;
    out[0] = commands.capacity;
    out[1] = commands.length;
    out[2] = (uint32_t)(uintptr_t)commands.internalArray;
    return commands.length;
}

// ── freestanding libc 原语（-fno-builtin -nostdlib；clang 会生成这些调用） ──
void *memcpy(void *d, const void *s, unsigned long n) {
    unsigned char *dd = d; const unsigned char *ss = s;
    while (n--) *dd++ = *ss++;
    return d;
}
void *memset(void *d, int c, unsigned long n) {
    unsigned char *dd = d;
    while (n--) *dd++ = (unsigned char)c;
    return d;
}
void *memmove(void *d, const void *s, unsigned long n) {
    unsigned char *dd = d; const unsigned char *ss = s;
    if (dd < ss) { while (n--) *dd++ = *ss++; }
    else { dd += n; ss += n; while (n--) *--dd = *--ss; }
    return d;
}
unsigned long strlen(const char *s) { unsigned long n = 0; while (s[n]) n++; return n; }
