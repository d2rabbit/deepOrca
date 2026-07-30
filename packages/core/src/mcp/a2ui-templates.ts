/**
 * A2UI Prototype Templates — pre-built component generators for common UI patterns.
 *
 * Instead of hand-writing A2UI JSON component trees (error-prone), the agent
 * picks a template and fills in parameters. The template generates the complete
 * adjacency-list component tree + initial data model.
 *
 * Templates: login-form, dashboard, list-detail, wizard, kanban, data-table
 */

/** A generated prototype: components + dataModel ready for render_surface. */
export interface PrototypeResult {
  components: Record<string, unknown>[];
  dataModel: Record<string, unknown>;
}

type TemplateParams = Record<string, unknown>;

/**
 * Generate a prototype from a template name + params.
 * Returns null if the template name is unknown.
 */
export function generatePrototype(template: string, params: TemplateParams): PrototypeResult | null {
  switch (template.toLowerCase()) {
    case "login-form":
      return loginForm(params);
    case "dashboard":
      return dashboard(params);
    case "list-detail":
      return listDetail(params);
    case "wizard":
      return wizard(params);
    case "kanban":
      return kanban(params);
    case "data-table":
      return dataTable(params);
    default:
      return null;
  }
}

/** Get the list of available template names + descriptions. */
export function listTemplates(): Array<{ name: string; description: string; params: string[] }> {
  return [
    {
      name: "login-form",
      description: "Login/registration form with text fields and submit button",
      params: ["fields (string[])", "title (string)"],
    },
    {
      name: "dashboard",
      description: "Dashboard with KPI metric cards and a content area",
      params: ["metrics ({label,value}[])", "title (string)"],
    },
    {
      name: "list-detail",
      description: "Master-detail layout: left list, right detail panel",
      params: ["items ({label,subtitle}[])", "detailFields (string[])"],
    },
    {
      name: "wizard",
      description: "Multi-step wizard with step indicator and navigation",
      params: ["steps (string[])", "title (string)"],
    },
    {
      name: "kanban",
      description: "Kanban board with columns and cards",
      params: ["columns (string[])", "cards ({title,column}[])"],
    },
    {
      name: "data-table",
      description: "Sortable data table with headers and rows",
      params: ["columns (string[])", "rows (string[][])"],
    },
  ];
}

// ── Template implementations ─────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function loginForm(params: TemplateParams): PrototypeResult {
  const fields = (params.fields as string[]) ?? ["Email", "Password"];
  const title = String(params.title ?? "Login");
  const components: Record<string, unknown>[] = [];
  const dataModel: Record<string, unknown> = {};

  const root = nextId("col");
  components.push({ id: root, type: "Column", properties: { gap: "md" } });

  const titleId = nextId("text");
  components.push({ id: titleId, type: "Text", parentId: root, properties: { text: title, variant: "heading" } });

  for (const field of fields) {
    const fieldId = nextId("tf");
    const key = field.toLowerCase().replace(/\s+/g, "_");
    components.push({
      id: fieldId,
      type: "TextField",
      parentId: root,
      properties: { placeholder: field, label: field, value: `$form.${key}` },
    });
    dataModel[`form.${key}`] = "";
  }

  const btnId = nextId("btn");
  components.push({
    id: btnId,
    type: "Button",
    parentId: root,
    properties: { label: "Submit", action: "submit" },
  });

  return { components, dataModel };
}

function dashboard(params: TemplateParams): PrototypeResult {
  const metrics = (params.metrics as Array<{ label: string; value: string }>) ?? [
    { label: "Users", value: "1,234" },
    { label: "Revenue", value: "$12.5k" },
  ];
  const title = String(params.title ?? "Dashboard");
  const components: Record<string, unknown>[] = [];

  const root = nextId("col");
  components.push({ id: root, type: "Column", properties: {} });

  const titleId = nextId("text");
  components.push({ id: titleId, type: "Text", parentId: root, properties: { text: title, variant: "heading" } });

  // Metrics row
  const rowId = nextId("row");
  components.push({ id: rowId, type: "Row", parentId: root, properties: {} });

  for (const m of metrics) {
    const cardId = nextId("card");
    components.push({ id: cardId, type: "Card", parentId: rowId, properties: {} });
    const labelId = nextId("text");
    components.push({ id: labelId, type: "Text", parentId: cardId, properties: { text: m.label, variant: "caption" } });
    const valueId = nextId("text");
    components.push({ id: valueId, type: "Text", parentId: cardId, properties: { text: m.value, variant: "title" } });
  }

  // Content area placeholder
  const contentCard = nextId("card");
  components.push({ id: contentCard, type: "Card", parentId: root, properties: {} });
  const placeholderId = nextId("text");
  components.push({
    id: placeholderId,
    type: "Text",
    parentId: contentCard,
    properties: { text: "Content area — ask me to add charts, tables, or lists here.", variant: "body" },
  });

  return { components, dataModel: {} };
}

function listDetail(params: TemplateParams): PrototypeResult {
  const items = (params.items as Array<{ label: string; subtitle?: string }>) ?? [
    { label: "Item 1", subtitle: "Description" },
    { label: "Item 2", subtitle: "Description" },
  ];
  const detailFields = (params.detailFields as string[]) ?? ["Name", "Status", "Created"];
  const components: Record<string, unknown>[] = [];

  const root = nextId("row");
  components.push({ id: root, type: "Row", properties: {} });

  // Left list
  const listCol = nextId("col");
  components.push({ id: listCol, type: "Column", parentId: root, properties: {} });
  const listTitle = nextId("text");
  components.push({
    id: listTitle,
    type: "Text",
    parentId: listCol,
    properties: { text: "Items", variant: "subtitle" },
  });
  const listId = nextId("list");
  components.push({ id: listId, type: "List", parentId: listCol, properties: {} });

  for (const item of items) {
    const cardId = nextId("card");
    components.push({ id: cardId, type: "Card", parentId: listId, properties: { action: "select" } });
    const labelId = nextId("text");
    components.push({ id: labelId, type: "Text", parentId: cardId, properties: { text: item.label, variant: "body" } });
    if (item.subtitle) {
      const subId = nextId("text");
      components.push({
        id: subId,
        type: "Text",
        parentId: cardId,
        properties: { text: item.subtitle, variant: "caption" },
      });
    }
  }

  // Right detail
  const detailCol = nextId("col");
  components.push({ id: detailCol, type: "Column", parentId: root, properties: {} });
  const detailTitle = nextId("text");
  components.push({
    id: detailTitle,
    type: "Text",
    parentId: detailCol,
    properties: { text: "Details", variant: "subtitle" },
  });
  const detailCard = nextId("card");
  components.push({ id: detailCard, type: "Card", parentId: detailCol, properties: {} });

  for (const field of detailFields) {
    const fieldText = nextId("text");
    components.push({
      id: fieldText,
      type: "Text",
      parentId: detailCard,
      properties: { text: `${field}: —`, variant: "body" },
    });
  }

  return { components, dataModel: { selectedItem: null } };
}

function wizard(params: TemplateParams): PrototypeResult {
  const steps = (params.steps as string[]) ?? ["Step 1", "Step 2", "Step 3"];
  const title = String(params.title ?? "Setup Wizard");
  const components: Record<string, unknown>[] = [];

  const root = nextId("col");
  components.push({ id: root, type: "Column", properties: {} });

  const titleId = nextId("text");
  components.push({ id: titleId, type: "Text", parentId: root, properties: { text: title, variant: "heading" } });

  // Step indicator row
  const stepsRow = nextId("row");
  components.push({ id: stepsRow, type: "Row", parentId: root, properties: {} });
  steps.forEach((step, i) => {
    const stepText = nextId("text");
    components.push({
      id: stepText,
      type: "Text",
      parentId: stepsRow,
      properties: { text: `${i + 1}. ${step}`, variant: i === 0 ? "title" : "caption" },
    });
  });

  // Current step content (placeholder)
  const contentCard = nextId("card");
  components.push({ id: contentCard, type: "Card", parentId: root, properties: {} });
  const contentText = nextId("text");
  components.push({
    id: contentText,
    type: "Text",
    parentId: contentCard,
    properties: { text: `Content for: ${steps[0]}`, variant: "body" },
  });

  // Navigation buttons
  const navRow = nextId("row");
  components.push({ id: navRow, type: "Row", parentId: root, properties: {} });
  const backBtn = nextId("btn");
  components.push({ id: backBtn, type: "Button", parentId: navRow, properties: { label: "← Back", action: "prev" } });
  const nextBtn = nextId("btn");
  components.push({ id: nextBtn, type: "Button", parentId: navRow, properties: { label: "Next →", action: "next" } });

  return { components, dataModel: { currentStep: 0, totalSteps: steps.length } };
}

function kanban(params: TemplateParams): PrototypeResult {
  const columns = (params.columns as string[]) ?? ["To Do", "In Progress", "Done"];
  const cards = (params.cards as Array<{ title: string; column: string }>) ?? [];
  const components: Record<string, unknown>[] = [];

  const root = nextId("row");
  components.push({ id: root, type: "Row", properties: {} });

  for (const col of columns) {
    const colId = nextId("col");
    components.push({ id: colId, type: "Column", parentId: root, properties: {} });
    const colTitle = nextId("text");
    components.push({ id: colTitle, type: "Text", parentId: colId, properties: { text: col, variant: "subtitle" } });

    // Cards in this column
    const colCards = cards.filter((c) => c.column === col);
    for (const card of colCards) {
      const cardId = nextId("card");
      components.push({ id: cardId, type: "Card", parentId: colId, properties: { action: "open" } });
      const cardText = nextId("text");
      components.push({
        id: cardText,
        type: "Text",
        parentId: cardId,
        properties: { text: card.title, variant: "body" },
      });
    }

    // "Add card" button
    const addBtn = nextId("btn");
    components.push({
      id: addBtn,
      type: "Button",
      parentId: colId,
      properties: { label: "+ Add", action: `add:${col}` },
    });
  }

  return { components, dataModel: {} };
}

function dataTable(params: TemplateParams): PrototypeResult {
  const columns = (params.columns as string[]) ?? ["Name", "Status", "Date"];
  const rows = (params.rows as string[][]) ?? [["Item A", "Active", "2026-01-01"]];
  const components: Record<string, unknown>[] = [];

  const root = nextId("col");
  components.push({ id: root, type: "Column", properties: {} });

  // Header row
  const headerRow = nextId("row");
  components.push({ id: headerRow, type: "Row", parentId: root, properties: {} });
  for (const col of columns) {
    const headerText = nextId("text");
    components.push({
      id: headerText,
      type: "Text",
      parentId: headerRow,
      properties: { text: col, variant: "subtitle" },
    });
  }

  // Data rows
  for (const row of rows) {
    const rowCard = nextId("card");
    components.push({ id: rowCard, type: "Card", parentId: root, properties: {} });
    const rowInner = nextId("row");
    components.push({ id: rowInner, type: "Row", parentId: rowCard, properties: {} });
    for (let i = 0; i < columns.length; i++) {
      const cellText = nextId("text");
      components.push({
        id: cellText,
        type: "Text",
        parentId: rowInner,
        properties: { text: row[i] ?? "—", variant: "body" },
      });
    }
  }

  return { components, dataModel: { columns, rows } };
}
