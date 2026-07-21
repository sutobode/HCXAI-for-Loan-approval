"use client";

import { HelpCircle } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface GlossaryTermProps {
  /** Tên thuật ngữ, phải khớp một khóa trong GLOSSARY (frontend/src/lib/glossary.ts). */
  term: GlossaryKey;
  className?: string;
}

/**
 * Hiển thị một thuật ngữ chuyên ngành (giữ nguyên tiếng Anh, đúng chuẩn) kèm
 * một icon nhỏ có thể hover/chạm để xem giải thích ngắn bằng tiếng Việt.
 *
 * Mục đích: người am hiểu vẫn thấy đúng tên thuật ngữ quen thuộc (SHAP, LIME,
 * Model Registry...), còn người không am hiểu có thể tra nghĩa ngay tại chỗ
 * mà không phải rời trang hoặc bị chặn hiểu toàn bộ giải thích.
 */
export function GlossaryTerm({ term, className }: GlossaryTermProps) {
  const entry = GLOSSARY[term];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex items-center gap-0.5 border-b border-dotted border-muted-foreground/50 font-medium",
              className
            )}
          >
            {term}
            <HelpCircle className="size-3 text-muted-foreground" />
          </span>
        }
      />
      <TooltipContent className="max-w-[280px] text-left whitespace-normal">
        {entry?.short ?? term}
      </TooltipContent>
    </Tooltip>
  );
}
