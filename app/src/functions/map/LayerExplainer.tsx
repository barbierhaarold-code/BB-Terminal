import { LAYER_INFO, type LayerId } from "./layerInfo";

/** Compact static explainer shown under a layer toggle while that layer is on. */
export function LayerExplainer({ id, on }: { id: LayerId; on: boolean }) {
  if (!on) return null;
  const i = LAYER_INFO[id];
  return (
    <div className="mt-1.5 border-l-2 border-term-amberDim pl-2 flex flex-col gap-1 text-[10px] leading-snug text-term-muted">
      <div>{i.what}</div>
      <div><span className="text-term-amber">Source:</span> {i.source} <span className="text-term-amber">Updates:</span> {i.updates}</div>
      <div><span className="text-term-amber">Markets:</span> {i.markets}</div>
    </div>
  );
}
