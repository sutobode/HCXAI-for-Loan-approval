"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Search, UserPlus, Phone, Briefcase, ArrowRight, CheckCircle2, XCircle, Clock } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listApplicants } from "@/lib/endpoints";

export default function ApplicantsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;

  // Simple debounce for search
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  function handleSearchChange(value: string) {
    setSearch(value);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, 350);
    setTimer(t);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["applicants", debouncedSearch, page],
    queryFn: () => listApplicants(PAGE_SIZE, page * PAGE_SIZE, debouncedSearch || undefined),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Khách hàng"
        description="Chọn khách hàng để chấm điểm tín dụng, hoặc xem lại kết quả đã duyệt."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => router.push("/applications/new")}>
            <UserPlus className="size-4" />
            Nhập hồ sơ mới
          </Button>
        }
      />

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Tìm theo tên, số điện thoại, email..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Results grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-lg font-medium">Chưa có khách hàng nào</p>
            <p className="text-sm text-muted-foreground">
              Chạy script seed dữ liệu hoặc nhập hồ sơ thủ công để bắt đầu.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Hiển thị {data.items.length} / {data.total} khách hàng
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((applicant) => {
              const hasPrediction = !!applicant.latest_prediction;
              const isApproved = applicant.latest_prediction?.prediction === "Approved";

              // UX: click khách đã chấm → xem kết quả, chưa chấm → mở form
              function handleClick() {
                if (hasPrediction && applicant.latest_prediction) {
                  router.push(`/applications/${applicant.latest_prediction.prediction_id}`);
                } else {
                  router.push(`/applications/new?applicant_id=${applicant.id}`);
                }
              }

              return (
                <Card
                  key={applicant.id}
                  className="group relative cursor-pointer transition-shadow hover:shadow-md"
                  onClick={handleClick}
                >
                  <CardContent className="p-4">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{applicant.full_name}</p>
                        {applicant.occupation && (
                          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <Briefcase className="size-3 shrink-0" />
                            {applicant.occupation}
                          </p>
                        )}
                        {applicant.phone && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="size-3 shrink-0" />
                            {applicant.phone}
                          </p>
                        )}
                      </div>
                      {/* Status badge */}
                      {hasPrediction ? (
                        <Badge
                          variant={isApproved ? "default" : "destructive"}
                          className="shrink-0 gap-1"
                        >
                          {isApproved ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <XCircle className="size-3" />
                          )}
                          {isApproved ? "Duyệt" : "Từ chối"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 gap-1 text-amber-600">
                          <Clock className="size-3" />
                          Chờ chấm
                        </Badge>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                      <span>{applicant.total_applications} hồ sơ</span>
                      <span className="flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        {hasPrediction ? "Xem kết quả" : "Chấm điểm"} <ArrowRight className="size-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Trước
              </Button>
              <span className="text-sm text-muted-foreground">
                Trang {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
