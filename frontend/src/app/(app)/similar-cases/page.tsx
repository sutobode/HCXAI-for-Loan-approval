"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Users2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoanApplicationForm } from "@/components/loan/loan-application-form";
import { findSimilarCases } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import type { LoanApplication, SimilarCasesResult } from "@/lib/types";

export default function SimilarCasesPage() {
  const [result, setResult] = useState<SimilarCasesResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: LoanApplication) {
    setIsLoading(true);
    try {
      const data = await findSimilarCases(values, 8);
      setResult(data);
      toast.success(`Đã tìm thấy ${data.cases.length} hồ sơ tương tự trong lịch sử`);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tra cứu Hồ sơ Tương tự"
        description="Suy luận theo trường hợp: tìm k hồ sơ trong lịch sử gần nhất (k-NN của scikit-learn) và so sánh kết quả của chúng."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin người vay</CardTitle>
            <CardDescription>Chúng tôi sẽ tìm trong dữ liệu huấn luyện những hồ sơ có đặc điểm tương tự nhất.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoanApplicationForm
              onSubmit={handleSubmit}
              isSubmitting={isLoading}
              submitLabel={isLoading ? "Đang tìm kiếm..." : "Tìm hồ sơ tương tự"}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          {result ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users2 className="size-4 text-primary" />
                    Phân phối kết quả
                  </CardTitle>
                  <CardDescription>
                    Trong số {result.cases.length} hồ sơ tương tự nhất trong lịch sử.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>Tỷ lệ được duyệt</span>
                    <span className="font-medium">
                      {Math.round((result.outcome_distribution.approval_rate ?? 0) * 100)}%
                    </span>
                  </div>
                  <Progress value={(result.outcome_distribution.approval_rate ?? 0) * 100} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{result.outcome_distribution.approved} được duyệt</span>
                    <span>{result.outcome_distribution.rejected} bị từ chối</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Các hồ sơ gần nhất</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mã hồ sơ</TableHead>
                        <TableHead>Độ tương tự</TableHead>
                        <TableHead>Kết quả</TableHead>
                        <TableHead>CIBIL</TableHead>
                        <TableHead>Thu nhập</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.cases.map((c) => (
                        <TableRow key={c.loan_id}>
                          <TableCell className="font-mono text-xs">#{c.loan_id}</TableCell>
                          <TableCell>{Math.round(c.similarity_score * 100)}%</TableCell>
                          <TableCell>
                            <Badge variant={c.outcome === "Approved" ? "default" : "destructive"}>
                              {c.outcome === "Approved" ? "Được duyệt" : "Bị từ chối"}
                            </Badge>
                          </TableCell>
                          <TableCell>{c.features.cibil_score}</TableCell>
                          <TableCell>{Number(c.features.income_annum).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center">
              <Users2 className="mb-3 size-8 text-muted-foreground" />
              <p className="font-medium">Chưa có tìm kiếm nào</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Điền thông tin để tìm các hồ sơ tương tự trong lịch sử.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
