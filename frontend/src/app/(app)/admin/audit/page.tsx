"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, ChevronLeft, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAuditLog } from "@/lib/endpoints";

const PAGE_SIZE = 25;

export default function AuditTrailPage() {
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", offset, appliedFilter],
    queryFn: () => listAuditLog(PAGE_SIZE, offset, appliedFilter || undefined),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhật ký Kiểm toán"
        description="AI Có trách nhiệm & Quản trị AI: mọi hành động quan trọng trên hệ thống, không thể chỉnh sửa và có gắn thời gian."
      />

      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <Label htmlFor="action-filter" className="mb-1.5">
              Lọc theo hành động (ví dụ: login.success, explain, model.train)
            </Label>
            <Input
              id="action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="Để trống để xem tất cả hành động"
            />
          </div>
          <Button
            onClick={() => {
              setOffset(0);
              setAppliedFilter(actionFilter);
            }}
          >
            Áp dụng
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-primary" />
            Nhật ký kiểm toán
          </CardTitle>
          <CardDescription>{data ? `${data.total} sự kiện` : "Đang tải..."}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : data && data.items.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Người dùng</TableHead>
                    <TableHead>Hành động</TableHead>
                    <TableHead>Đối tượng</TableHead>
                    <TableHead>Chi tiết</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString("vi-VN")}
                      </TableCell>
                      <TableCell className="text-sm">{entry.user_id ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.resource_type ? `${entry.resource_type} #${entry.resource_id}` : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {Object.keys(entry.details).length > 0 ? JSON.stringify(entry.details) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Hiển thị {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} / {data.total}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    <ChevronLeft className="size-4" />
                    Trước
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + PAGE_SIZE >= data.total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Tiếp
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có sự kiện kiểm toán nào được ghi nhận.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
