 import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { User, UserPlus, Edit, Trash2, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { z } from "zod";
import type { TaskLedgerUser } from "@shared/schema";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const userSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  role: z.enum(["user", "admin"]),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

type UserFormData = z.infer<typeof userSchema>;

export default function UserManagementModal({ isOpen, onClose }: UserManagementModalProps) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [editingUser, setEditingUser] = useState<TaskLedgerUser | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; fullName: string } | null>(null);

  const { data: users, isLoading } = useQuery<TaskLedgerUser[]>({
    queryKey: ["/api/users"],
    enabled: isOpen && currentUser?.role === 'admin',
  });

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      username: "",
      email: "",
      fullName: "",
      role: "user",
      password: "",
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      return await apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User created successfully" });
      setShowForm(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create user", description: error.message, variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UserFormData> }) => {
      return await apiRequest("PUT", `/api/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User updated successfully" });
      setEditingUser(null);
      setShowForm(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete user", description: error.message, variant: "destructive" });
    },
  });

  const handleAddUser = () => {
    setEditingUser(null);
    setShowForm(true);
    form.reset({
      username: "",
      email: "",
      fullName: "",
      role: "user",
      password: "",
    });
  };

  const handleEditUser = (user: TaskLedgerUser) => {
    setEditingUser(user);
    setShowForm(true);
    form.reset({
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role as "user" | "admin",
      password: "", // Don't pre-fill password for security
    });
  };

  const handleDeleteUser = (user: TaskLedgerUser) => {
    setUserToDelete({ id: user.id, fullName: user.fullName });
  };

  const onSubmit = (data: UserFormData) => {
    if (editingUser) {
      // For updates, only send password if it's provided
      const updateData = { ...data };
      if (!updateData.password) {
        delete updateData.password;
      }
      updateUserMutation.mutate({ id: editingUser.id, data: updateData });
    } else {
      // For creation, password is required
      if (!data.password) {
        form.setError("password", { message: "Password is required for new users" });
        return;
      }
      createUserMutation.mutate(data);
    }
  };

  const handleClose = () => {
    setShowForm(false);
    setEditingUser(null);
    form.reset();
    onClose();
  };

  // Only show for admin users
  if (currentUser?.role !== 'admin') {
    return null;
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-user-management">
        <DialogHeader>
          <DialogTitle>User Management</DialogTitle>
        </DialogHeader>
        
        <div className="mt-6">
          {showForm ? (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium">
                  {editingUser ? 'Edit User' : 'Add New User'}
                </h3>
                <Button 
                  variant="outline" 
                  onClick={() => setShowForm(false)}
                  data-testid="button-cancel-form"
                >
                  Cancel
                </Button>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-user-fullname" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-user-username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" data-testid="input-user-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-user-role">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="user">Normal User</SelectItem>
                              <SelectItem value="admin">Admin User</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Password {editingUser && <span className="text-muted-foreground text-xs">(leave blank to keep current)</span>}
                          </FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-user-password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="modal-footer-actions">
                    <Button
                      type="submit"
                      disabled={createUserMutation.isPending || updateUserMutation.isPending}
                      data-testid="button-save-user"
                    >
                      {(createUserMutation.isPending || updateUserMutation.isPending) && (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      )}
                      {editingUser ? 'Update User' : 'Create User'}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <Button 
                  onClick={handleAddUser}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-add-user"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add New User
                </Button>
              </div>
              
              {isLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                  <p className="text-muted-foreground">Loading users...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {users?.map((user) => (
                    <div 
                      key={user.id} 
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white border rounded-2xl"
                      data-testid={`user-item-${user.id}`}
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground" data-testid={`user-name-${user.id}`}>
                            {user.fullName}
                          </h4>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                          <p className="text-xs text-muted-foreground">@{user.username}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <Badge 
                          variant={user.role === 'admin' ? 'default' : 'secondary'}
                          data-testid={`user-role-${user.id}`}
                        >
                          {user.role === 'admin' ? 'Admin User' : 'Normal User'}
                        </Badge>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditUser(user)}
                            className="text-muted-foreground hover:text-foreground"
                            data-testid={`button-edit-user-${user.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteUser(user)}
                            disabled={user.id === currentUser?.id}
                            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                            data-testid={`button-delete-user-${user.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {users?.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No users found</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* Delete User Confirmation Dialog - Type to Confirm */}
    <ConfirmDeleteByNameDialog
      open={!!userToDelete}
      onClose={() => setUserToDelete(null)}
      entityLabel="User"
      entityName={userToDelete?.fullName ?? ""}
      onConfirm={async () => {
        if (!userToDelete) return;
        await deleteUserMutation.mutateAsync(userToDelete.id);
        setUserToDelete(null);
      }}
    />
  </>
  );
}
