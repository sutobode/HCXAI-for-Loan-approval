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
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z.string().min(8, "New password must be at least 8 characters"),
    confirm_password: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
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
      toast.success("Password changed successfully");
      form.reset();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to change password")),
  });

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title="Settings" description="Manage your account security." />

      {isDefaultAdmin && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Change the default admin password</AlertTitle>
          <AlertDescription>
            This account is still using the well-known default credentials
            ({DEFAULT_ADMIN_EMAIL} / {DEFAULT_ADMIN_PASSWORD}). Anyone who has read the
            project documentation knows this password — change it below before using
            this account outside of local development.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            Change password
          </CardTitle>
          <CardDescription>Requires your current password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="current_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current password</FormLabel>
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
                    <FormLabel>New password</FormLabel>
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
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={mutation.isPending} className="w-full">
                {mutation.isPending ? "Changing..." : "Change password"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
