"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  FilePlus2,
  FlaskConical,
  Users2,
  ShieldCheck,
  ActivitySquare,
  ShieldHalf,
  LogOut,
  Landmark,
  ChevronsUpDown,
  GitCompareArrows,
  Cpu,
  ScrollText,
  Layers,
  History,
  Settings,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuthStore } from "@/stores/auth-store";
import type { UserRole } from "@/lib/types";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Loan Queue", href: "/applications", icon: ListChecks },
  { title: "Submit Application", href: "/applications/new", icon: FilePlus2 },
  { title: "What-If Lab", href: "/whatif", icon: FlaskConical },
  { title: "Similar Cases", href: "/similar-cases", icon: Users2 },
  { title: "Trust Dashboard", href: "/trust", icon: ShieldCheck },
  { title: "Explanation History", href: "/hcxai/explanation-history", icon: History },
  {
    title: "Override Analysis",
    href: "/hcxai/override-analysis",
    icon: GitCompareArrows,
    roles: ["admin", "risk_manager"],
  },
  {
    title: "Global Explainability",
    href: "/explainability/global",
    icon: Layers,
    roles: ["admin", "risk_manager", "loan_officer"],
  },
  {
    title: "Fairness Report",
    href: "/fairness",
    icon: ShieldHalf,
    roles: ["admin", "risk_manager"],
  },
  {
    title: "Model Monitoring",
    href: "/monitoring",
    icon: ActivitySquare,
    roles: ["admin", "risk_manager"],
  },
  {
    title: "AI Model Center",
    href: "/model-center",
    icon: Cpu,
    roles: ["admin", "risk_manager"],
  },
  { title: "Admin · Users", href: "/admin/users", icon: Users2, roles: ["admin"] },
  { title: "Admin · Audit Trail", href: "/admin/audit", icon: ScrollText, roles: ["admin"] },
  { title: "Settings", href: "/settings", icon: Settings },
];

function initialsFromName(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  risk_manager: "Risk Manager",
  loan_officer: "Loan Officer",
  customer: "Customer",
};

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );

  function handleLogout() {
    clearAuth();
    router.push("/login");
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Landmark className="size-4" />
          </div>
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="font-heading text-sm font-semibold">HCXAI Platform</span>
            <span className="text-xs text-muted-foreground">Loan Approval</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href) && item.href !== "/applications/new");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                      {initialsFromName(user.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col text-left leading-none group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-medium">{user.full_name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              }
            />
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {user.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} variant="destructive">
                <LogOut className="size-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
