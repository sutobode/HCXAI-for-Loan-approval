"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api";

export interface InterpretResult {
  narrative: string;
  model: string;
}

interface AiInterpretButtonProps {
  onRun: () => Promise<InterpretResult>;
  label?: string;
}

/**
 * Nút "Diễn giải bằng AI" dùng chung cho mọi mặt XAI (LIME, Explanation
 * Quality, Counterfactual, Fairness, Monitoring, Trust Dashboard...).
 * Chỉ gọi khi người dùng bấm (on-demand) -- không tự động chạy nền.
 */
export function AiInterpretButton({ onRun, label = "Diễn giải bằng AI" }: AiInterpretButtonProps) {
  const mutation = useMutation({
    mutationFn: onRun,
    onError: (error) => toast.error(getApiErrorMessage(error, "Diễn giải thất bại")),
  });

  if (mutation.data) {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-primary/5 p-3" aria-live="polite">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="text-sm leading-relaxed">{mutation.data.narrative}</p>
          {mutation.data.model === "template-fallback" && (
            <p className="mt-1 text-xs text-muted-foreground">(diễn giải mẫu — dịch vụ AI tạm thời không khả dụng)</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <RefreshCw className="size-3" />
            Diễn giải lại
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      <Sparkles className="size-4" />
      {mutation.isPending ? "Đang diễn giải..." : label}
    </Button>
  );
}
