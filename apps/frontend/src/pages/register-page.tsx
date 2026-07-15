import { useAuth } from "@/hooks/use-auth";
import { Redirect, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { z } from "zod";

const registerSchema = z
  .object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Valid email is required"),
    fullName: z.string().min(2, "Full name is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  business: "Business",
};

export default function RegisterPage() {
  const { user, registerMutation } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const plan = params.get("plan") || "starter";
  const duration = params.get("duration") || "1";
  const workspace = params.get("workspace") || "";
  const paid = params.get("paid") === "true";

  const planLabel = PLAN_LABELS[plan] || plan;

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: workspace || "",
      email: "",
      fullName: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onRegister = (data: RegisterFormData) => {
    const { confirmPassword, ...registerData } = data;
    registerMutation.mutate(registerData);
  };

  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: "#D5CFD0" }}
    >
      {/* Left Panel — Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img
              src="/logo.png"
              alt="Task Ledger"
              className="h-16 w-auto mx-auto mb-4"
            />
            <h1
              className="text-3xl font-bold"
              style={{ color: "#010100", letterSpacing: "0.01em" }}
            >
              Task Ledger
            </h1>
            <p className="mt-2" style={{ color: "#7D6B75" }}>
              Create your workspace
            </p>
          </div>

          {/* Mock payment confirmation banner */}
          {paid && (
            <div
              className="flex items-center gap-3 rounded-2xl px-5 py-4 mb-6"
              style={{ backgroundColor: "#ecfdf5", border: "1px solid #a7f3d0" }}
            >
              <CheckCircle2
                className="h-6 w-6 shrink-0"
                style={{ color: "#058A77" }}
              />
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: "#065f46" }}
                >
                  Payment confirmed
                </p>
                <p className="text-xs" style={{ color: "#047857" }}>
                  {planLabel} plan ({duration}-month) — activated. Set up your
                  account below.
                </p>
              </div>
            </div>
          )}

          <Card
            className="shadow-2xl border-0 rounded-[32px]"
            style={{ backgroundColor: "#ffffff" }}
          >
            <CardHeader className="text-center pb-4 pt-8">
              <CardTitle
                className="text-2xl font-bold"
                style={{ color: "#010100" }}
              >
                Create Account
              </CardTitle>
              <CardDescription
                className="text-base"
                style={{ color: "#7D6B75" }}
              >
                Fill in your details to get started
              </CardDescription>
            </CardHeader>

            <CardContent className="px-4 sm:px-8 pb-6 sm:pb-8">
              <Form {...registerForm}>
                <form
                  onSubmit={registerForm.handleSubmit(onRegister)}
                  className="space-y-4"
                >
                  <FormField
                    control={registerForm.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold text-sm"
                          style={{ color: "#010100" }}
                        >
                          Full Name
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="name"
                            className="h-12 rounded-2xl focus:ring-2"
                            style={{
                              backgroundColor: "#F2F2F1",
                              borderColor: "#C1B9BC",
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={registerForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold text-sm"
                          style={{ color: "#010100" }}
                        >
                          Username
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="username"
                            className="h-12 rounded-2xl focus:ring-2"
                            style={{
                              backgroundColor: "#F2F2F1",
                              borderColor: "#C1B9BC",
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={registerForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold text-sm"
                          style={{ color: "#010100" }}
                        >
                          Email
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            autoComplete="email"
                            className="h-12 rounded-2xl focus:ring-2"
                            style={{
                              backgroundColor: "#F2F2F1",
                              borderColor: "#C1B9BC",
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={registerForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold text-sm"
                          style={{ color: "#010100" }}
                        >
                          Password
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                            className="h-12 rounded-2xl focus:ring-2"
                            style={{
                              backgroundColor: "#F2F2F1",
                              borderColor: "#C1B9BC",
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={registerForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="font-semibold text-sm"
                          style={{ color: "#010100" }}
                        >
                          Confirm Password
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                            className="h-12 rounded-2xl focus:ring-2"
                            style={{
                              backgroundColor: "#F2F2F1",
                              borderColor: "#C1B9BC",
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full shadow-lg text-base font-bold py-6 rounded-full"
                    style={{ backgroundColor: "#058A77", color: "#ffffff" }}
                    disabled={registerMutation.isPending}
                  >
                    {registerMutation.isPending && (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    )}
                    Create Account
                  </Button>
                </form>
              </Form>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-green-600">
                <ShieldCheck className="h-4 w-4" />
                Your data is encrypted and secure
              </div>

              <div className="mt-6 text-center">
                <a
                  href="/auth"
                  className="text-sm font-medium hover:underline"
                  style={{ color: "#058A77" }}
                >
                  Already have an account? Sign in
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right Panel — Hero */}
      <div
        className="hidden lg:flex flex-1 items-center justify-center p-8 shadow-2xl"
        style={{
          background:
            "linear-gradient(135deg, #058A77 0%, #2F6D59 50%, #17483F 100%)",
        }}
      >
        <div className="text-center max-w-md">
          <div className="w-24 h-24 bg-white/10 backdrop-blur-sm rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20 p-2">
            <img
              src="/logo.png"
              alt="Task Ledger"
              className="h-full w-auto object-contain"
            />
          </div>
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "0.01em" }}
          >
            You're almost there
          </h2>
          <p
            className="text-lg mb-8 leading-relaxed"
            style={{ color: "#ffffff", opacity: 0.9 }}
          >
            Complete your registration to start managing tasks, renewals, assets,
            and compliance in one place.
          </p>
          <ul className="text-left space-y-4 text-white">
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              {planLabel} plan — {duration === "1" ? "monthly" : `${duration}-month`} billing
            </li>
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              Instant workspace setup
            </li>
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              30-day money-back guarantee
            </li>
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              Free document storage & backups
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
