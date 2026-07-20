"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FilePlus2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPredictions } from "@/lib/endpoints";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function ApplicationsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<"all" | "Approved" | "Rejected">("all");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["predictions", page, pageSize],
    queryFn: () => listPredictions(pageSize, page * pageSize),
  });

  const filteredItems = (data?.items ?? []).filter(
    (p) => statusFilter === "all" || p.prediction === statusFilter
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loan Queue"
        description="Browse and filter all scored loan applications."
        actions={
          <Button render={<Link href="/applications/new" />}>
            <FilePlus2 className="size-4" />
            New application
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status</span>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No applications match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Approval probability</TableHead>
                  <TableHead>Risk score</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">#{p.id}</TableCell>
                    <TableCell>
                      <Badge variant={p.prediction === "Approved" ? "default" : "destructive"}>
                        {p.prediction}
                      </Badge>
                    </TableCell>
                    <TableCell>{Math.round(p.approval_probability * 100)}%</TableCell>
                    <TableCell>{Math.round(p.risk_score * 100)}%</TableCell>
                    <TableCell>{Math.round(p.confidence * 100)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" render={<Link href={`/applications/${p.id}`} />}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between border-t p-4">
            <p className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} &middot; {data?.total ?? 0} total predictions
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
