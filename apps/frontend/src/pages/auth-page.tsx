import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Valid email is required"),
  fullName: z.string().min(2, "Full name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginFormData = z.infer<typeof loginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [isRegister, setIsRegister] = useState(false);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      email: "",
      fullName: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onLogin = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  const onRegister = (data: RegisterFormData) => {
    const { confirmPassword, ...registerData } = data;
    registerMutation.mutate(registerData);
  };

  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen flex" style={{backgroundColor: '#D5CFD0'}}>
      {/* Left Panel - Forms */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img
              src="/logo.png"
              alt="Task Ledger"
              className="h-16 w-auto mx-auto mb-4"
            />
            <h1 className="text-3xl font-bold" style={{color: '#010100', letterSpacing: '0.01em'}}>Task Ledger</h1>
            <p className="mt-2" style={{color: '#7D6B75'}}>Manage your tasks efficiently</p>
          </div>

          <Card className="shadow-2xl border-0 rounded-[32px]" style={{backgroundColor: '#ffffff'}}>
            <CardHeader className="text-center pb-4 pt-8">
              <CardTitle className="text-2xl font-bold" style={{color: '#010100'}}>
                {isRegister ? "Create Account" : "Welcome Back"}
              </CardTitle>
              <CardDescription className="text-base" style={{color: '#7D6B75'}}>
                {isRegister ? "Sign up to get started" : "Sign in to your account to continue"}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-8 pb-6 sm:pb-8">
              {!isRegister ? (
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-5">
                    <FormField
                      control={loginForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Username</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-username" autoComplete="username" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-password" autoComplete="current-password" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full shadow-lg text-base font-bold py-6 rounded-full"
                      style={{backgroundColor: '#058A77', color: '#ffffff'}}
                      disabled={loginMutation.isPending}
                      data-testid="button-login"
                    >
                      {loginMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                      Sign In
                    </Button>
                  </form>
                </Form>
              ) : (
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                    <FormField
                      control={registerForm.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Full Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-fullname" autoComplete="name" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
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
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Username</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-reg-username" autoComplete="username" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
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
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Email</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" data-testid="input-email" autoComplete="email" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
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
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-reg-password" autoComplete="new-password" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
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
                          <FormLabel className="font-semibold text-sm" style={{color: '#010100'}}>Confirm Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-confirm-password" autoComplete="new-password" className="h-12 rounded-2xl focus:ring-2" style={{backgroundColor: '#F2F2F1', borderColor: '#C1B9BC'}} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full shadow-lg text-base font-bold py-6 rounded-full"
                      style={{backgroundColor: '#058A77', color: '#ffffff'}}
                      disabled={registerMutation.isPending}
                      data-testid="button-register"
                    >
                      {registerMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                      Create Account
                    </Button>
                  </form>
                </Form>
              )}

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setIsRegister(!isRegister)}
                  className="text-sm font-medium hover:underline"
                  style={{color: '#058A77'}}
                >
                  {isRegister ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right Panel - Hero */}
      <div className="hidden lg:flex flex-1 items-center justify-center p-8 shadow-2xl" style={{background: 'linear-gradient(135deg, #058A77 0%, #2F6D59 50%, #17483F 100%)'}}>
        <div className="text-center max-w-md">
          <div className="w-24 h-24 bg-white/10 backdrop-blur-sm rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20 p-2">
            <img
              src="/logo.png"
              alt="Task Ledger"
              className="h-full w-auto object-contain"
            />
          </div>
          <h2 className="text-4xl font-bold text-white mb-4" style={{letterSpacing: '0.01em'}}>
            Streamline Your Task Management
          </h2>
          <p className="text-lg mb-8 leading-relaxed" style={{color: '#ffffff', opacity: 0.9}}>
            Keep track of due dates, tasks, license renewals, vehicle insurance, 
            and asset maintenance all in one place.
          </p>
          <ul className="text-left space-y-4 text-white">
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              Multi-property tax tracking
            </li>
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              Vehicle insurance management
            </li>
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              Asset & machinery service dates
            </li>
            <li className="flex items-center bg-white/10 backdrop-blur-sm rounded-2xl p-4">
              <div className="w-2 h-2 bg-white rounded-full mr-3" />
              Document storage & reminders
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
