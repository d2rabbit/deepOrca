/**
 * Legacy A2UI format → v0.9 protocol converter (specs/a2ui-integration R2).
 *
 * Dependency-free so BOTH the renderer (live straggler batches) and the main
 * process (persisted `.deeporca/prototypes/*.json` written before the R2
 * revamp) can use it. The legacy format was the homegrown pre-v0.9 dialect:
 * flat `{type: "createSurface", ...}` messages, lowercase component types,
 * `parentId` back-references, `${path}` string-template bindings and props
 * either flat or under `properties`. Everything converts to the official
 * v0.9 wire format ({version, createSurface|updateComponents|…} with
 * PascalCase types, forward `children` lists, `{path}` dynamic values).
 */

/** The official basic catalog id (matches basicCatalog.id in @a2ui/react). */
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

type LegacyComponent = {
  id: string;
  type?: string;
  parentId?: string | null;
  properties?: Record<string, unknown>;
  _delete?: boolean;
  [key: string]: unknown;
};

type V09Component = { id: string; component: string } & Record<string, unknown>;

type V09Message = Record<string, unknown>;

/** Lowercase legacy type → official PascalCase component. */
const TYPE_MAP: Record<string, string> = {
  column: "Column",
  row: "Row",
  card: "Card",
  list: "List",
  tabs: "Tabs",
  divider: "Divider",
  text: "Text",
  icon: "Icon",
  image: "Image",
  button: "Button",
  textfield: "TextField",
  input: "TextField",
  checkbox: "CheckBox",
  choicepicker: "ChoicePicker",
  select: "ChoicePicker",
  kanbancolumn: "Card",
  kanbancard: "Card",
  metriccard: "Card",
};

/** Legacy text variants → official Text.usageHint enum. */
const VARIANT_MAP: Record<string, string> = {
  title: "h2",
  heading: "h2",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  body: "body",
  caption: "caption",
};

/** `${path}` templates → official {path} bindings; everything else passes. */
function dyn(value: unknown): unknown {
  if (typeof value === "string") {
    const m = value.match(/^\$\{(.+)\}$/);
    if (m) return { path: m[1] };
    const legacy = value.match(/^\$(?! \$)([A-Za-z0-9_][\w./-]*)$/);
    if (legacy) return { path: legacy[1] };
  }
  return value;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** True when the parsed batch is the pre-v0.9 homegrown dialect. */
export function isLegacyBatch(messages: unknown[]): boolean {
  return messages.length > 0 && messages.every((m) => m && typeof m === "object" && "type" in m && !("version" in m));
}

/**
 * Convert one legacy message batch into official v0.9 messages.
 * Stateless: legacy batches handled here are full snapshots (the stateful
 * merge dialect only ever came from the pre-R2 update_surface tool, whose
 * persisted files keep full component arrays). `_delete` markers are honored
 * within the batch.
 */
export function convertLegacyBatch(messages: unknown[]): V09Message[] {
  const out: V09Message[] = [];
  for (const raw of messages) {
    const msg = raw as { type?: string; [k: string]: unknown };
    switch (msg.type) {
      case "createSurface": {
        const surfaceId = str(msg.surfaceId);
        if (surfaceId) {
          out.push({ version: "v0.9", createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID } });
        }
        break;
      }
      case "updateComponents": {
        const surfaceId = str(msg.surfaceId);
        const components = Array.isArray(msg.components) ? (msg.components as LegacyComponent[]) : [];
        if (surfaceId) {
          out.push({
            version: "v0.9",
            updateComponents: { surfaceId, components: convertLegacyComponents(components) },
          });
        }
        break;
      }
      case "updateDataModel": {
        const surfaceId = str(msg.surfaceId);
        const dataModel = msg.dataModel ?? msg.value;
        if (surfaceId && dataModel && typeof dataModel === "object") {
          out.push({ version: "v0.9", updateDataModel: { surfaceId, path: "/", value: dataModel } });
        }
        break;
      }
      case "deleteSurface": {
        const surfaceId = str(msg.surfaceId);
        if (surfaceId) out.push({ version: "v0.9", deleteSurface: { surfaceId } });
        break;
      }
      default:
        // Unknown legacy message kinds are dropped (forward-only conversion).
        break;
    }
  }
  return out;
}

/** Convert a legacy parentId-adjacency component array into official
 * forward-children components, synthesizing a Column root when needed. */
export function convertLegacyComponents(input: LegacyComponent[]): V09Component[] {
  const live = input.filter((c) => c && typeof c.id === "string" && !c._delete);
  const byParent = new Map<string, LegacyComponent[]>();
  const topLevel: LegacyComponent[] = [];
  const ids = new Set(live.map((c) => c.id));
  for (const c of live) {
    if (typeof c.parentId === "string" && ids.has(c.parentId)) {
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    } else {
      topLevel.push(c);
    }
  }

  const out: V09Component[] = [];
  const childrenOf = (id: string): string[] => (byParent.get(id) ?? []).map((c) => c.id);

  const convert = (c: LegacyComponent): V09Component => {
    const type = TYPE_MAP[String(c.type ?? "text").toLowerCase()] ?? "Card";
    const props: Record<string, unknown> = { ...(c.properties ?? {}) };
    for (const [k, v] of Object.entries(c)) {
      if (k !== "id" && k !== "type" && k !== "parentId" && k !== "properties" && k !== "_delete") {
        props[k] = v;
      }
    }
    const kids = childrenOf(c.id);
    const base = { id: c.id, component: type };

    switch (type) {
      case "Column":
      case "Row":
      case "List":
        return { ...base, children: kids };
      case "Card": {
        // Official Card takes exactly ONE child; wrap multiple in a Column.
        if (kids.length === 0) {
          const placeholderId = `${c.id}-empty`;
          out.push({ id: placeholderId, component: "Text", text: "" });
          return { ...base, child: placeholderId };
        }
        if (kids.length === 1) return { ...base, child: kids[0] };
        const innerId = `${c.id}-inner`;
        out.push({ id: innerId, component: "Column", children: kids });
        return { ...base, child: innerId };
      }
      case "Divider":
        return { ...base };
      case "Text":
        return {
          ...base,
          text: dyn(props.text ?? props.content ?? props.label ?? ""),
          ...(props.variant != null ? { variant: VARIANT_MAP[String(props.variant)] ?? "body" } : {}),
        };
      case "Icon": {
        const name = str(props.name);
        // Official Icon names are Material Symbols camelCase identifiers.
        if (name && /^[a-z][a-zA-Z0-9]*$/.test(name)) return { ...base, name };
        return { id: c.id, component: "Text", text: name ?? "▸" };
      }
      case "Image":
        return {
          ...base,
          url: dyn(props.src ?? props.url ?? ""),
          ...(props.alt != null ? { description: dyn(props.alt) } : {}),
        };
      case "Button": {
        const label = str(props.label ?? props.text) ?? "";
        const labelId = `${c.id}-label`;
        const action = str(props.action);
        out.push({ id: labelId, component: "Text", text: dyn(label) });
        return {
          ...base,
          child: labelId,
          ...(props.variant === "primary" || props.variant === "borderless" ? { variant: props.variant } : {}),
          ...(action ? { action: { event: { name: action } } } : {}),
        };
      }
      case "TextField":
        return {
          ...base,
          label: dyn(props.label ?? props.placeholder ?? ""),
          ...(props.value != null ? { value: dyn(props.value) } : {}),
        };
      case "CheckBox":
        return {
          ...base,
          label: dyn(props.label ?? ""),
          ...(props.checked != null || props.value != null ? { value: dyn(props.checked ?? props.value) } : {}),
        };
      case "ChoicePicker": {
        const options = Array.isArray(props.options)
          ? (props.options as Array<Record<string, unknown>>).map((o, i) => ({
              label: str(o.label ?? o.value) ?? String(i),
              value: str(o.value ?? o.label) ?? String(i),
            }))
          : [];
        return {
          ...base,
          ...(str(props.label) != null ? { label: dyn(props.label) } : {}),
          ...(options.length > 0 ? { options } : {}),
          ...(props.value != null ? { value: dyn(props.value) } : {}),
        };
      }
      default:
        return { ...base };
    }
  };

  const converted = live.map(convert);
  const rootIds = topLevel.map((c) => c.id);
  const hasRoot = converted.some((c) => c.id === "root");
  if (hasRoot || rootIds.length === 0) {
    return [...converted, ...out];
  }
  return [{ id: "root", component: "Column", children: rootIds }, ...converted, ...out];
}
