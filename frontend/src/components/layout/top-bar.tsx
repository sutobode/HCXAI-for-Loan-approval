"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Tổng quan",
  "/applicants": "Khách hàng",
  "/applications": "Danh sách hồ sơ vay",
  "/applications/new": "Nộp hồ sơ vay",
  "/whatif": "Phòng thí nghiệm Giả định",
  "/similar-cases": "Tra cứu Hồ sơ Tương tự",
  "/trust": "Bảng Tin cậy",
  "/hcxai/explanation-history": "Lịch sử Giải thích",
  "/hcxai/override-analysis": "Phân tích Ghi đè của Con người",
  "/explainability/global": "Global Explainability",
  "/fairness": "Công bằng & AI Có trách nhiệm",
  "/monitoring": "Giám sát Mô hình",
  "/model-center": "Trung tâm Mô hình AI",
  "/admin/users": "Quản lý Người dùng",
  "/admin/audit": "Nhật ký Kiểm toán",
  "/settings": "Cài đặt",
};

function resolveTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/applications/")) return "Chi tiết Hồ sơ";
  return "Hệ thống HCXAI";
}

export function TopBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="font-heading text-sm font-medium">
              {resolveTitle(pathname)}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Chuyển đổi giao diện sáng/tối"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>
    </header>
  );
}
