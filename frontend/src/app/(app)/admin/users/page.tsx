"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { listUsers, registerUser } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";

const registerSchema = z.object({
  email: z.string().email("Vui lòng nhập email hợp lệ"),
  full_name: z.string().min(2, "Vui lòng nhập họ tên"),
  password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự"),
  role: z.enum(["admin", "risk_manager", "loan_officer", "customer"]),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

const ROLE_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  risk_manager: "secondary",
  loan_officer: "outline",
  customer: "outline",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị viên",
  risk_manager: "Quản lý Rủi ro",
  loan_officer: "Chuyên viên Tín dụng",
  customer: "Khách hàng",
};

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
  });

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", full_name: "", password: "", role: "loan_officer" },
  });

  const mutation = useMutation({
    mutationFn: registerUser,
    onSuccess: () => {
      toast.success("Đã tạo người dùng");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      form.reset();
      setOpen(false);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quản lý Người dùng"
        description="Tạo và quản lý tài khoản trên hệ thống. Chỉ dành cho quản trị viên (theo phân quyền RBAC)."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <Button>
                  <UserPlus className="size-4" />
                  Người dùng mới
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Tạo người dùng mới</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="full_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Họ tên</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mật khẩu tạm thời</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vai trò</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="admin">Quản trị viên</SelectItem>
                            <SelectItem value="risk_manager">Quản lý Rủi ro</SelectItem>
                            <SelectItem value="loan_officer">Chuyên viên Tín dụng</SelectItem>
                            <SelectItem value="customer">Khách hàng</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={mutation.isPending} className="w-full">
                    Tạo người dùng
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Toàn bộ người dùng</CardTitle>
          <CardDescription>{users?.length ?? 0} tài khoản trên hệ thống.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Họ tên</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Vai trò</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Ngày tạo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE_VARIANT[u.role]} className="capitalize">
                        {ROLE_LABELS[u.role] ?? u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? "default" : "secondary"}>
                        {u.is_active ? "Đang hoạt động" : "Ngừng hoạt động"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString("vi-VN")}
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
