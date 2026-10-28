# ADR 0001: Build the modeler as a web app on the bpmn.io toolkit

- Status: Accepted
- Date: 2026-10-26

## Context

Activiti 9 has no maintained modeler:
- The open-source Activiti Modeling App (Angular, bpmn-js 6) was archived in 2023.
- Alfresco Process Automation's modeler is proprietary.
- Camunda Modeler writes `camunda:`/`zeebe:` extensions. Activiti silently ignores these ([R1 §0.1](../research/activiti-9-bpmn-support.md)).

The modeler is meant to run in a browser, or in a native window on macOS. Building a BPMN diagram editor from scratch would mean rebuilding canvas, rendering, DI, editing tools and XML I/O: years of work that bpmn.io already provides.

## Decision

- **Toolkit:** build a web application on `bpmn-js` 18.x, `dmn-js` 18.x, `bpmn-js-properties-panel` 5.x and `@bpmn-io/properties-panel` 3.x.
- **Activiti layer:** add our own `activiti` moddle descriptor, properties providers, modeling behaviours, lint rules and project handling.
- **Camunda code:**
  - Don't load any `camunda:`/`zeebe:` moddle, provider or behaviour.
  - Where a Camunda-coupled module has a useful design, fork it under MIT and re-point it to `activiti:`. This applies to the properties provider, behaviours and the element-template engine.
- **App shell:** React 18 and TypeScript, built with Vite. Properties-panel entries are Preact components, following the `@bpmn-io/properties-panel` convention.
- **macOS:** a native wrapper is optional and not built (feature U23). The app is a PWA-capable static bundle that a Tauri or WKWebView shell can host unchanged.

## Consequences

- **Licence:** the bpmn.io licence requires the bpmn.io watermark to stay visible and un-overlapped on every bpmn-js and dmn-js canvas. UI layout must respect this in every view that shows a canvas.
- **Versions:** bpmn.io versions are pinned and upgraded as a set.
- **Reuse:** editor features come mostly for free: palette, context pad, replace, search, copy/paste, align, lasso, space tool, minimap, grid and so on. Engineering effort goes into Activiti semantics.
