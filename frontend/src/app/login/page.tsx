"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { motion } from "framer-motion";
import { Landmark, Loader2, ShieldCheck, Sparkles, Scale } from "lucide-react";
import { toast } from "sonner";

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { login } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

const loginSchema = z.object({
  email: z.string().min(3, "Vui lòng nhập email"),
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const FEATURES = [
  {
    icon: Sparkles,
    title: "Giải thích Thích ứng",
    description: "Thông tin chuyên sâu dựa trên SHAP, được diễn giải bởi LLM, phù hợp với vai trò của bạn.",
  },
  {
    icon: ShieldCheck,
    title: "Cân chỉnh Độ tin cậy",
    description: "Hệ thống học cách đội ngũ của bạn tin tưởng vào từng quyết định như thế nào.",
  },
  {
    icon: Scale,
    title: "Giám sát Công bằng",
    description: "Kiểm tra liên tục tính công bằng nhân khẩu học theo quy tắc bốn phần năm.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues) {
    setIsSubmitting(true);
    try {
      const result = await login(values.email, values.password);
      setAuth(result.access_token, result.user);
      toast.success(`Chào mừng trở lại, ${result.user.full_name.split(" ")[0]}`);
      router.push("/dashboard");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Email hoặc mật khẩu không đúng"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left: brand / feature panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-primary to-[oklch(0.4_0.2_290)] p-10 text-primary-foreground lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.15),transparent_45%)]" />
        <div className="relative z-10 flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/15">
            <Landmark className="size-5" />
          </div>
          <span className="font-heading text-lg font-semibold">Hệ thống HCXAI</span>
        </div>

        <div className="relative z-10 space-y-8">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-md font-heading text-3xl font-semibold leading-tight"
          >
            Trí tuệ Nhân tạo Giải thích được, Lấy Con người làm Trung tâm cho Duyệt vay Thông minh
          </motion.h1>
          <div className="grid gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.1 }}
                className="flex items-start gap-3"
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <f.icon className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-sm text-primary-foreground/70">{f.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-primary-foreground/60">
          Nền tảng HCXAI cho doanh nghiệp &middot; SHAP + Diễn giải bằng DeepSeek
        </p>
      </div>

      {/* Right: login form */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <Card className="border-none shadow-none sm:border sm:shadow-sm">
            <CardHeader>
              <CardTitle className="font-heading text-xl">Đăng nhập</CardTitle>
              <CardDescription>
                Sử dụng thông tin tài khoản của bạn để truy cập hệ thống.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@bank.com"
                            autoComplete="email"
                            {...field}
                          />
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
                        <FormLabel>Mật khẩu</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            autoComplete="current-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                    Đăng nhập
                  </Button>
                </form>
              </Form>

              <div className="mt-6 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Tài khoản demo mặc định</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span className="text-muted-foreground">Email:</span>
                  <code className="select-all font-mono text-foreground">admin@hcxai.local</code>
                  <span className="text-muted-foreground">Mật khẩu:</span>
                  <code className="select-all font-mono text-foreground">ChangeMe123!</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
