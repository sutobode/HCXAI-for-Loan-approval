"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  FileCheck2,
  FilePlus2,
  Gauge,
  ShieldAlert,
  TrendingUp,
  ArrowRight,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPredictions } from "@/lib/endpoints";
import { useAuthStore } from "@/stores/auth-store";

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  tone = "default",
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClasses: Record<string, string> = {
    default: "text-primary bg-primary/10",
    success: "text-success bg-success/10",
    warning: "text-warning bg-warning/10",
    destructive: "text-destructive bg-destructive/10",
  };

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 font-heading text-2xl font-semibold">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={`flex size-11 items-center justify-center rounded-xl ${toneClasses[tone]}`}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: ["predictions", "recent"],
    queryFn: () => listPredictions(8, 0),
  });

  const items = data?.items ?? [];
  const approved = items.filter((p) => p.prediction === "Approved").length;
  const rejected = items.length - approved;
  const avgConfidence =
    items.length > 0
      ? items.reduce((sum, p) => sum + p.confidence, 0) / items.length
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Chào mừng trở lại${user ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        description="Tổng quan các quyết định vay gần đây và tình trạng hoạt động của hệ thống."
        actions={
          <Button nativeButton={false} render={<Link href="/applications/new" />}>
            <FilePlus2 className="size-4" />
            Hồ sơ mới
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Hồ sơ gần đây"
          value={String(data?.total ?? "—")}
          icon={FileCheck2}
          hint="8 hồ sơ mới nhất"
        />
        <StatCard
          title="Được duyệt"
          value={String(approved)}
          icon={TrendingUp}
          tone="success"
          hint={items.length ? `${Math.round((approved / items.length) * 100)}% trong số gần đây` : undefined}
        />
        <StatCard
          title="Bị từ chối"
          value={String(rejected)}
          icon={ShieldAlert}
          tone="destructive"
          hint={items.length ? `${Math.round((rejected / items.length) * 100)}% trong số gần đây` : undefined}
        />
        <StatCard
          title="Độ tin cậy TB"
          value={items.length ? `${Math.round(avgConfidence * 100)}%` : "—"}
          icon={Gauge}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Quyết định gần đây</CardTitle>
            <CardDescription>Các hồ sơ vay được chấm điểm gần đây nhất.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/applications" />}>
            Xem tất cả
            <ArrowRight className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Chưa có hồ sơ nào. Hãy nộp hồ sơ đầu tiên để bắt đầu.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Quyết định</TableHead>
                  <TableHead>Xác suất duyệt</TableHead>
                  <TableHead>Độ tin cậy</TableHead>
                  <TableHead>Thời gian nộp</TableHead>
                  <TableHead className="text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">#{p.id}</TableCell>
                    <TableCell>
                      <Badge variant={p.prediction === "Approved" ? "default" : "destructive"}>
                        {p.prediction === "Approved" ? "Được duyệt" : "Bị từ chối"}
                      </Badge>
                    </TableCell>
                    <TableCell>{Math.round(p.approval_probability * 100)}%</TableCell>
                    <TableCell>{Math.round(p.confidence * 100)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleString("vi-VN")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/applications/${p.id}`} />}>
                        Xem
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
