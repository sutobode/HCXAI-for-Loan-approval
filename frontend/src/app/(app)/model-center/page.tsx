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
import { GlossaryTerm } from "@/components/ui/glossary-term";
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
    mutationFn: () => trainModelVersion({ notes: "Huấn luyện lại thủ công từ Trung tâm Mô hình", activate: true }),
    onSuccess: (result) => {
      toast.success(`Đã huấn luyện và kích hoạt ${result.version_label}`);
      queryClient.invalidateQueries({ queryKey: ["model-versions"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Huấn luyện thất bại")),
  });

  const activateMutation = useMutation({
    mutationFn: (label: string) => activateModelVersion(label),
    onSuccess: (result) => {
      toast.success(`Đã kích hoạt ${result.version_label} làm phiên bản chính`);
      queryClient.invalidateQueries({ queryKey: ["model-versions"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Kích hoạt thất bại")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trung tâm Mô hình AI"
        description={
          <>
            Quản lý <GlossaryTerm term="Model Registry" />, Experiment Tracking, và{" "}
            <GlossaryTerm term="Champion-Challenger" /> cho mô hình duyệt vay.
          </>
        }
        actions={
          isAdmin ? (
            <Button onClick={() => trainMutation.mutate()} disabled={trainMutation.isPending}>
              <PlayCircle className="size-4" />
              {trainMutation.isPending ? "Đang huấn luyện..." : "Huấn luyện phiên bản mới"}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4 text-primary" />
            Các phiên bản mô hình
          </CardTitle>
          <CardDescription>
            Mỗi phiên bản đã huấn luyện đều được lưu trữ đầy đủ cùng chỉ số đánh giá.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : versions && versions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phiên bản</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Thuật toán</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead><GlossaryTerm term="F1" /></TableHead>
                  <TableHead><GlossaryTerm term="AUC" /></TableHead>
                  <TableHead>Người huấn luyện</TableHead>
                  <TableHead>Thời gian tạo</TableHead>
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
                          Đang hoạt động (chính)
                        </Badge>
                      ) : (
                        <Badge variant="outline">Không hoạt động</Badge>
                      )}
                    </TableCell>
                    <TableCell>{v.algorithm}</TableCell>
                    <TableCell>{(v.metrics.accuracy * 100).toFixed(2)}%</TableCell>
                    <TableCell>{v.metrics.f1_score.toFixed(4)}</TableCell>
                    <TableCell>{v.metrics.auc.toFixed(4)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.trained_by}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(v.created_at).toLocaleString("vi-VN")}
                    </TableCell>
                    <TableCell>
                      {isAdmin && !v.is_active && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activateMutation.isPending}
                          onClick={() => activateMutation.mutate(v.version_label)}
                        >
                          Kích hoạt
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có phiên bản mô hình nào được huấn luyện.</p>
          )}
        </CardContent>
      </Card>

      {versions && versions.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="size-4 text-primary" />
              So sánh <GlossaryTerm term="Champion-Challenger" />
            </CardTitle>
            <CardDescription>So sánh song song các chỉ số giữa hai phiên bản bất kỳ.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Select value={compareA} onValueChange={(v) => v && setCompareA(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Phiên bản A" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version_label} value={v.version_label}>
                      {v.version_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">so với</span>
              <Select value={compareB} onValueChange={(v) => v && setCompareB(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Phiên bản B" />
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
                So sánh
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
