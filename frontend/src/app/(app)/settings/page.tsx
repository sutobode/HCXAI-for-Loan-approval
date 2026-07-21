"use client";

import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { KeyRound, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { changePassword } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

const DEFAULT_ADMIN_EMAIL = "admin@hcxai.local";
const DEFAULT_ADMIN_PASSWORD = "ChangeMe123!";

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
    new_password: z.string().min(8, "Mật khẩu mới phải có ít nhất 8 ký tự"),
    confirm_password: z.string().min(1, "Vui lòng xác nhận mật khẩu mới"),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Mật khẩu không khớp",
    path: ["confirm_password"],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isDefaultAdmin = user?.email === DEFAULT_ADMIN_EMAIL;

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordFormValues) =>
      changePassword({ current_password: values.current_password, new_password: values.new_password }),
    onSuccess: () => {
      toast.success("Đổi mật khẩu thành công");
      form.reset();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Đổi mật khẩu thất bại")),
  });

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title="Cài đặt" description="Quản lý bảo mật tài khoản của bạn." />

      {isDefaultAdmin && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Hãy đổi mật khẩu quản trị mặc định</AlertTitle>
          <AlertDescription>
            Tài khoản này vẫn đang sử dụng thông tin đăng nhập mặc định đã biết công khai
            ({DEFAULT_ADMIN_EMAIL} / {DEFAULT_ADMIN_PASSWORD}). Bất kỳ ai đã đọc tài liệu dự án
            đều biết mật khẩu này — hãy đổi ngay bên dưới trước khi dùng tài khoản này
            ngoài môi trường phát triển cục bộ.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            Đổi mật khẩu
          </CardTitle>
          <CardDescription>Yêu cầu nhập mật khẩu hiện tại.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="current_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mật khẩu hiện tại</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="new_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mật khẩu mới</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirm_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Xác nhận mật khẩu mới</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={mutation.isPending} className="w-full">
                {mutation.isPending ? "Đang xử lý..." : "Đổi mật khẩu"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
