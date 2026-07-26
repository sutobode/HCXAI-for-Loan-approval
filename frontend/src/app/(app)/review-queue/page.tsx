"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, Eye } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { getReviewQueue, resolveReview } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";

const REASON_LABELS: Record<string, string> = {
  low_confidence: "Độ tin cậy thấp",
  high_loan_amount: "Số tiền vay lớn",
  fairness_group_flag: "Thuộc nhóm vi phạm công bằng",
  self_flagged: "Tự nguyện gắn cờ",
};

export default function ReviewQueuePage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["review-queue"],
    queryFn: () => getReviewQueue(),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "confirmed" | "overridden" }) =>
      resolveReview(id, decision),
    onSuccess: () => {
      toast.success("Đã duyệt hồ sơ");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Duyệt hồ sơ thất bại")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hàng chờ duyệt"
        description="Hồ sơ cần con người xem xét trước khi coi là hoàn tất — do độ tin cậy thấp, số tiền vay lớn, thuộc nhóm đang vi phạm công bằng, hoặc được tự nguyện gắn cờ."
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <ShieldAlert className="size-8" />
          <p>Không có hồ sơ nào đang chờ duyệt.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Quyết định AI</TableHead>
                  <TableHead>Lý do cần duyệt</TableHead>
                  <TableHead className="text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  let reasons: string[] = [];
                  try {
                    reasons = JSON.parse(item.review_reasons || "[]");
                  } catch {
                    reasons = [];
                  }
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">#{item.id}</TableCell>
                      <TableCell className="max-w-[140px] truncate text-sm">
                        {item.applicant_name ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.prediction === "Approved" ? "default" : "destructive"}>
                          {item.prediction === "Approved" ? "Được duyệt" : "Bị từ chối"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {reasons.map((r) => (
                            <Badge key={r} variant="outline">
                              {REASON_LABELS[r] ?? r}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/applications/${item.id}`} />}
                        >
                          <Eye className="size-4" />
                          Xem
                        </Button>
                        <Button
                          size="sm"
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate({ id: item.id, decision: "confirmed" })}
                        >
                          Xác nhận
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate({ id: item.id, decision: "overridden" })}
                        >
                          Ghi đè
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
