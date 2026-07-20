"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
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
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { LoanApplication } from "@/lib/types";

export const loanApplicationSchema = z.object({
  no_of_dependents: z.coerce.number().int().min(0).max(20),
  education: z.enum(["Graduate", "Not Graduate"]),
  self_employed: z.enum(["Yes", "No"]),
  income_annum: z.coerce.number().positive("Must be greater than 0"),
  loan_amount: z.coerce.number().positive("Must be greater than 0"),
  loan_term: z.coerce.number().int().positive("Must be greater than 0"),
  cibil_score: z.coerce.number().int().min(300).max(900),
  residential_assets_value: z.coerce.number().min(0),
  commercial_assets_value: z.coerce.number().min(0),
  luxury_assets_value: z.coerce.number().min(0),
  bank_asset_value: z.coerce.number().min(0),
});

export type LoanApplicationFormValues = z.infer<typeof loanApplicationSchema>;

export const DEFAULT_APPLICATION: LoanApplicationFormValues = {
  no_of_dependents: 2,
  education: "Graduate",
  self_employed: "No",
  income_annum: 9_600_000,
  loan_amount: 29_900_000,
  loan_term: 12,
  cibil_score: 778,
  residential_assets_value: 2_400_000,
  commercial_assets_value: 17_600_000,
  luxury_assets_value: 22_700_000,
  bank_asset_value: 8_000_000,
};

interface LoanApplicationFormProps {
  defaultValues?: LoanApplicationFormValues;
  onSubmit: (values: LoanApplication) => void | Promise<void>;
  submitLabel?: string;
  isSubmitting?: boolean;
  onValuesChange?: (values: LoanApplicationFormValues) => void;
}

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

export function LoanApplicationForm({
  defaultValues = DEFAULT_APPLICATION,
  onSubmit,
  submitLabel = "Submit",
  isSubmitting = false,
  onValuesChange,
}: LoanApplicationFormProps) {
  const form = useForm<LoanApplicationFormValues>({
    resolver: zodResolver(loanApplicationSchema) as Resolver<LoanApplicationFormValues>,
    defaultValues,
  });

  const cibilScore = form.watch("cibil_score");

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSubmit(values satisfies LoanApplication))}
        onChange={() => onValuesChange?.(form.getValues())}
        className="space-y-6"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            control={form.control}
            name="no_of_dependents"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dependents</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={20} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="education"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Education</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Graduate">Graduate</SelectItem>
                    <SelectItem value="Not Graduate">Not Graduate</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="self_employed"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Self-employed</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="No">No</SelectItem>
                    <SelectItem value="Yes">Yes</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="income_annum"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Annual income</FormLabel>
                <FormControl>
                  <Input type="number" step={10000} {...field} />
                </FormControl>
                <FormDescription>
                  {currencyFormatter.format(Number(field.value) || 0)}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="loan_amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Loan amount requested</FormLabel>
                <FormControl>
                  <Input type="number" step={10000} {...field} />
                </FormControl>
                <FormDescription>
                  {currencyFormatter.format(Number(field.value) || 0)}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="loan_term"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Loan term (months)</FormLabel>
                <FormControl>
                  <Input type="number" min={1} max={480} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="residential_assets_value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Residential assets</FormLabel>
                <FormControl>
                  <Input type="number" step={10000} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="commercial_assets_value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Commercial assets</FormLabel>
                <FormControl>
                  <Input type="number" step={10000} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="luxury_assets_value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Luxury assets</FormLabel>
                <FormControl>
                  <Input type="number" step={10000} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="bank_asset_value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bank assets</FormLabel>
                <FormControl>
                  <Input type="number" step={10000} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="cibil_score"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Credit score (CIBIL)</FormLabel>
                <span className="font-mono text-sm font-medium text-primary">{cibilScore}</span>
              </div>
              <FormControl>
                <Slider
                  min={300}
                  max={900}
                  step={1}
                  value={[field.value]}
                  onValueChange={(v) => field.onChange(Array.isArray(v) ? v[0] : v)}
                />
              </FormControl>
              <FormDescription>Range: 300 (poor) &ndash; 900 (excellent)</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </form>
    </Form>
  );
}
