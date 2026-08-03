---
name: a2ui-prototype
description: >-
  Build interactive UI prototypes using A2UI Surfaces. Use when the user asks
  to create a prototype, mockup, wireframe, demo, or interactive UI demo
  (原型, 模型, 线框图, 演示). The agent uses render_surface to create a
  declarative Surface, update_surface to iterate, and the user can click
  buttons and fill forms to test the interaction flow. This is NOT HTML
  design (use deep-design for that) — it's live, interactive prototyping
  that stays connected to the agent for incremental refinement.
---

# A2UI Prototype — Interactive UI Prototyping

Build interactive prototypes using A2UI Surfaces — declarative component
trees that render inline and support user interaction (clicks, forms).

## When to Use

- User asks for a prototype, mockup, wireframe, or demo (原型/模型/线框图/演示)
- User types `/pm-design` or `/prototype` command
- User wants to validate an interaction flow or UI layout
- User wants to iterate on a design via conversation

## Trigger

- **Slash command**: `/pm-design` or `/prototype` — opens the right-side preview panel
- **Automatic**: when you call `render_prototype`, the preview panel opens automatically
- The preview panel shows alongside the chat — user can see both the conversation
  and the live prototype at the same time (split view)

## When NOT to Use

- Static design deliverables → use `deep-design` skill (produces HTML files)
- Slide presentations → use `bento-slides` skill
- Production code → write actual React/HTML via write tool

## Workflow

### Step 1 (PREFERRED): Use a Template

Call `mcp__a2ui__render_prototype` — pick a template, fill in params, done:

```json
{
  "template": "login-form",
  "surfaceId": "login",
  "title": "Login Form",
  "params": {
    "fields": ["Email", "Password"],
    "title": "Welcome Back"
  }
}
```

Available templates (call `mcp__a2ui__list_templates` for details):

| Template | params | Use case |
|----------|--------|----------|
| `login-form` | `fields[]`, `title` | Login/registration forms |
| `dashboard` | `metrics[{label,value}]`, `title` | KPI dashboards |
| `list-detail` | `items[{label,subtitle}]`, `detailFields[]` | Master-detail layouts |
| `wizard` | `steps[]`, `title` | Multi-step flows |
| `kanban` | `columns[]`, `cards[{title,column}]` | Task boards |
| `data-table` | `columns[]`, `rows[][]` | Data tables |
| `multi-page` | `pages[{name,title}]`, `title` | Multi-page prototype with navigation |

### Step 1 (FALLBACK): Manual Components

If no template fits, call `mcp__a2ui__render_surface` with hand-written components:

```json
{
  "surfaceId": "login-form",
  "title": "Login Form Prototype",
  "components": [
    {"id": "c1", "type": "Column", "properties": {}},
    {"id": "c2", "type": "Text", "parentId": "c1", "properties": {"text": "Welcome Back", "variant": "heading"}},
    {"id": "c3", "type": "TextField", "parentId": "c1", "properties": {"placeholder": "Email", "label": "Email"}},
    {"id": "c4", "type": "TextField", "parentId": "c1", "properties": {"placeholder": "Password", "label": "Password"}},
    {"id": "c5", "type": "Button", "parentId": "c1", "properties": {"label": "Sign In", "action": "login"}}
  ],
  "dataModel": {
    "email": "",
    "password": ""
  }
}
```

### Step 2: Iterate via Conversation

When the user says "add a remember me checkbox" or "change the layout to
two columns", call `mcp__a2ui__update_surface` with the new component tree:

```json
{
  "surfaceId": "login-form",
  "components": [
    {"id": "c1", "type": "Column", "properties": {}},
    {"id": "c2", "type": "Text", "parentId": "c1", "properties": {"text": "Welcome Back", "variant": "heading"}},
    {"id": "c3", "type": "TextField", "parentId": "c1", "properties": {"placeholder": "Email"}},
    {"id": "c4", "type": "TextField", "parentId": "c1", "properties": {"placeholder": "Password"}},
    {"id": "c5", "type": "CheckBox", "parentId": "c1", "properties": {"label": "Remember me"}},
    {"id": "c6", "type": "Button", "parentId": "c1", "properties": {"label": "Sign In", "action": "login"}}
  ]
}
```

### Step 3: User Interaction

When the user clicks a button on the Surface, you'll receive an
`a2ui_action` call. Respond to it — e.g., validate the form, show a
success message, or update the Surface to show the next screen.

## Component Types (Basic Catalog)

| Type | Key Properties |
|------|---------------|
| **Column** | (container — vertical layout) |
| **Row** | (container — horizontal layout) |
| **Card** | (container — bordered card) |
| **List** | (container — list items) |
| **Tabs** | (container — tabbed panels) |
| **Divider** | (visual separator) |
| **Text** | `text` (content), `variant` (heading/title/subtitle/body/caption) |
| **Icon** | `name` (emoji or symbol) |
| **Image** | `src` (URL), `alt` (description) |
| **Button** | `label` (text), `action` (action name for click handling) |
| **TextField** | `placeholder`, `label`, `value` (bound to dataModel) |
| **CheckBox** | `label`, `checked` (bound to dataModel) |
| **ChoicePicker** | `options` (array of {label, value}), `value` (selected) |

## Component Structure

Every component is a flat object in an adjacency list:

```json
{
  "id": "unique-id",
  "type": "ComponentType",
  "parentId": "parent-id-or-undefined-for-root",
  "properties": { ... }
}
```

- `id`: unique string identifier
- `type`: one of the Basic Catalog types above
- `parentId`: ID of the parent container (omit for root-level components)
- `properties`: type-specific key-value pairs

## Data Binding

Bind component properties to the data model using `${path}` explicit syntax
(preferred — no ambiguity with literal `$` strings like `"$12.50"`):

```json
{
  "id": "name-field",
  "type": "TextField",
  "properties": {
    "value": "${form/name}",
    "placeholder": "Enter name"
  }
}
```

This binds the `value` property to `dataModel.form.name` (path split on `/`).

**Legacy syntax**: `$form.name` also works — it looks up `dataModel["form.name"]`
(single key with dots). Only resolves if the key exists; otherwise treated as
a literal string. Prefer `${...}` for new prototypes.

## Best Practices

1. **Start simple** — create a minimal Surface, then iterate
2. **Use meaningful IDs** — `login-btn` not `c5`
3. **One root container** — usually a Column for forms, Row for dashboards
4. **Group with Cards** — use Card components to visually group sections
5. **Always provide actions** — buttons without actions do nothing
6. **Close when done** — call `close_surface` when the prototyping session ends
