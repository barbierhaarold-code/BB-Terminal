import { type ReactNode } from "react";
import { FN_BY_CODE, type FunctionCode } from "@/lib/functions";

interface Props {
  code: FunctionCode;
  symbol?: string;
  children: ReactNode;
}

export function FunctionPanel({ code, symbol, children }: Props) {
  const fn = FN_BY_CODE[code];
  return (
    <div className="panel flex-1 min-h-0 min-w-0">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <span className="text-term-heading">{fn.name}</span>
          {symbol && (
            <>
              <span className="text-term-muted">·</span>
              <span className="text-term-amberBright num">{symbol}</span>
            </>
          )}
          <span className="text-term-muted/50 text-[9px] font-normal">{code}</span>
        </div>
        <div className="text-term-muted normal-case tracking-normal font-normal text-[10px]">
          {fn.summary}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">{children}</div>
    </div>
  );
}
