/** @jsxImportSource @bpmn-io/properties-panel/preact */

export interface ItemToolsProps {
  id: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove(delta: -1 | 1): void;
}

/** Move up / move down for an item of a list whose order matters (listeners run in document order, mapException is first match). */
export function ItemTools({ id, canMoveUp, canMoveDown, onMove }: ItemToolsProps) {
  return (
    <div class="bio-properties-panel-entry activiti-item-tools" data-entry-id={id}>
      <button type="button" class="activiti-tool" disabled={!canMoveUp} title="Move up" aria-label="Move up" onClick={() => onMove(-1)}>
        ↑ Move up
      </button>
      <button type="button" class="activiti-tool" disabled={!canMoveDown} title="Move down" aria-label="Move down" onClick={() => onMove(1)}>
        ↓ Move down
      </button>
    </div>
  );
}
