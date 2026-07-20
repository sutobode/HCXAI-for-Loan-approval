"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History, ArrowRight, FileText } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getExplanationHistory } from "@/lib/endpoints";
import { useAuthStore } from "@/stores/auth-store";

export default function ExplanationHistoryPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [userId, setUserId] = useState(currentUser?.email ?? "");
  const [queryUserId, setQueryUserId] = useState(currentUser?.email ?? "");

  const { data, isLoading } = useQuery({
    queryKey: ["explanation-history", queryUserId],
    queryFn: () => getExplanationHistory(queryUserId),
    enabled: !!queryUserId,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Explanation History"
        description="Every prediction a user has requested an explanation for or given feedback on, in order."
      />

      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <Label htmlFor="history-user" className="mb-1.5">
              User ID (email)
            </Label>
            <Input id="history-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <Button onClick={() => setQueryUserId(userId)}>Load</Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="relative space-y-4 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-px before:bg-border">
          {data.map((item) => (
            <div key={item.id} className="relative flex gap-4 pl-0">
              <div
                className={`relative z-10 mt-1 flex size-10 shrink-0 items-center justify-center rounded-full border-4 border-background ${
                  item.prediction === "Approved" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                }`}
              >
                <FileText className="size-4" />
              </div>
              <Card className="flex-1">
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{item.id}</span>
                      <Badge variant={item.prediction === "Approved" ? "default" : "destructive"}>
                        {item.prediction}
                      </Badge>
                      <Badge variant="outline">{Math.round(item.confidence * 100)}% confidence</Badge>
                      <Badge variant="outline" className="font-mono">
                        model {item.model_version}
                      </Badge>
                    </div>
                    <p className="mt-1.5 truncate text-sm text-muted-foreground">
                      {item.narrative ?? "No narrative recorded for this prediction."}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                      {item.narrative_model ? ` · ${item.narrative_model}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" render={<Link href={`/applications/${item.id}`} />}>
                    View
                    <ArrowRight className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      ) : queryUserId ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <History className="size-8" />
          <p>No explanation history found for &ldquo;{queryUserId}&rdquo;.</p>
        </div>
      ) : null}
    </div>
  );
}
