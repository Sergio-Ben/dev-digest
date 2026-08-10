"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";
import {
  buildGraphModel,
  FONT_FAMILY,
  FONT_SIZE,
  type BlastNode,
  type BlastNodeKind,
} from "./graph";

const STROKE: Record<BlastNodeKind, string> = {
  symbol: "var(--accent-text)",
  caller: "var(--border-strong)",
  endpoint: "var(--accent-text)",
};

const FILL: Record<BlastNodeKind, string> = {
  symbol: "var(--accent-bg)",
  caller: "var(--bg-elevated)",
  endpoint: "var(--bg-elevated)",
};

const CORNER_RADIUS = 8;

interface BlastGraphProps {
  data: BlastRadiusResult;
  width: number;
  height: number;
}

export function BlastGraph({ data, width, height }: BlastGraphProps) {
  const t = useTranslations("prReview.blastRadius");
  const model = useMemo(() => buildGraphModel(data), [data]);

  if (model.nodes.length === 0 || width === 0 || height === 0) return null;

  // Shrink to fit, never magnify: scaling a two-node graph up to fill a 400px
  // card turns it into billboard text.
  const scale = Math.min(1, width / model.width, height / model.height);
  const tx = (width - model.width * scale) / 2;
  const ty = (height - model.height * scale) / 2;

  const hidden = [
    model.overflow.callers > 0
      ? t("moreCallers", { count: model.overflow.callers })
      : null,
    model.overflow.endpoints > 0
      ? t("moreEndpoints", { count: model.overflow.endpoints })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={t("graphTitle")}
      className="block"
    >
      <g transform={`translate(${tx},${ty}) scale(${scale})`}>
        {/* Edges first so the boxes always sit on top of the curves. */}
        <g fill="none" stroke="var(--border)" strokeWidth={1} opacity={0.85}>
          {model.edges.map((e) => (
            <path key={e.id} d={e.path} />
          ))}
        </g>

        {model.nodes.map((n) => (
          <GraphNode key={n.id} node={n} />
        ))}

        {hidden && (
          <text
            x={0}
            y={model.height - 4}
            fontSize={11}
            fill="var(--text-muted)"
          >
            {hidden}
          </text>
        )}
      </g>
    </svg>
  );
}

function GraphNode({ node }: { node: BlastNode }) {
  return (
    <g>
      {/* Native SVG tooltip: the label is truncated to fit its box, so the full
          path/line detail has to be reachable somewhere. */}
      <title>{node.title}</title>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={CORNER_RADIUS}
        ry={CORNER_RADIUS}
        fill={FILL[node.kind]}
        stroke={STROKE[node.kind]}
        strokeWidth={1}
      />
      <text
        x={node.x + node.width / 2}
        y={node.y + node.height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={FONT_FAMILY}
        fontSize={FONT_SIZE}
        fill="var(--text-primary)"
        style={{ userSelect: "none" }}
      >
        {node.label}
      </text>
    </g>
  );
}
