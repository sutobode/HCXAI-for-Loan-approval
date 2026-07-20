"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cpu, PlayCircle, CheckCircle2, GitCompareArrows, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  activateModelVersion,
  compareModelVersions,
  listModelVersions,
  trainModelVersion,
} from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

export default function ModelCenterPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const queryClient = useQueryClient();

  const { data: versions, isLoading } = useQuery({
    queryKey: ["model-versions"],
    queryFn: listModelVersions,
  });

  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");

  const { data: comparison, refetch: runComparison, isFetching: isComparing } = useQuery({
    queryKey: ["model-compare", compareA, compareB],
    queryFn: () => compareModelVersions(compareA, compareB),
    enabled: false,
  });

  const trainMutation = useMutation({
    mutationFn: () => trainModelVersion({ notes: "Manual retrain from Model Center", activate: true }),
    onSuccess: (result) => {
      toast.success(`Trained and activated ${result.version_label}`);
      queryClient.invalidateQueries({ queryKey: ["model-versions"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Training failed")),
  });

  const activateMutation = useMutation({
    mutationFn: (label: string) => activateModelVersion(label),
    onSuccess: (result) => {
      toast.success(`Activated ${result.version_label} as the new champion`);
      queryClient.invalidateQueries({ queryKey: ["model-versions"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Activation failed")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Model Center"
        description="Model Registry, Experiment Tracking, and Champion-Challenger management for the loan-approval model."
        actions={
          isAdmin ? (
            <Button onClick={() => trainMutation.mutate()} disabled={trainMutation.isPending}>
              <PlayCircle className="size-4" />
              {trainMutation.isPending ? "Training..." : "Train new version"}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4 text-primary" />
            Model versions
          </CardTitle>
          <CardDescription>
            Every trained version is preserved with full artifacts and evaluation metrics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : versions && versions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Algorithm</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>F1</TableHead>
                  <TableHead>AUC</TableHead>
                  <TableHead>Trained by</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.version_label}</TableCell>
                    <TableCell>
                      {v.is_active ? (
                        <Badge className="gap-1">
                          <CheckCircle2 className="size-3" />
                          Active (champion)
                        </Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>{v.algorithm}</TableCell>
                    <TableCell>{(v.metrics.accuracy * 100).toFixed(2)}%</TableCell>
                    <TableCell>{v.metrics.f1_score.toFixed(4)}</TableCell>
                    <TableCell>{v.metrics.auc.toFixed(4)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.trained_by}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {isAdmin && !v.is_active && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activateMutation.isPending}
                          onClick={() => activateMutation.mutate(v.version_label)}
                        >
                          Activate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No model versions trained yet.</p>
          )}
        </CardContent>
      </Card>

      {versions && versions.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="size-4 text-primary" />
              Champion-Challenger comparison
            </CardTitle>
            <CardDescription>Side-by-side metric comparison between any two versions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Select value={compareA} onValueChange={(v) => v && setCompareA(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Version A" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version_label} value={v.version_label}>
                      {v.version_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">vs.</span>
              <Select value={compareB} onValueChange={(v) => v && setCompareB(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Version B" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version_label} value={v.version_label}>
                      {v.version_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={!compareA || !compareB || isComparing}
                onClick={() => runComparison()}
              >
                Compare
              </Button>
            </div>

            {comparison && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p className="text-sm">{comparison.recommendation}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  {Object.entries(comparison.metric_deltas).map(([metric, delta]) => (
                    <div key={metric}>
                      <p className="text-xs text-muted-foreground capitalize">{metric.replace("_", " ")}</p>
                      <p
                        className={`font-heading text-lg font-semibold ${
                          delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(4)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
