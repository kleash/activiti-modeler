/**
 * Positions for the corpus builds. The seeds are hand-written without a layout; the builds place the shapes on a grid so
 * that the generated diagrams are readable when opened in the modeler. `at(column, row)` is the centre of a shape.
 */
export const at = (column: number, row: number): { x: number; y: number } => ({ x: 120 + column * 160, y: 110 + row * 110 });
