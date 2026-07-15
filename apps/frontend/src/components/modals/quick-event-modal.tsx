import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { optimisticCreate, rollbackCalendarQueries, invalidateCalendarQueries, generateTempId } from "@/lib/optimistic-updates";
import { TimePicker12H } from "@/components/ui/time-picker-12h";
import { convert24To12Hour } from "@/lib/utils";

interface QuickEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: Date;
}

export default function QuickEventModal({ isOpen, onClose, initialDate }: QuickEventModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(initialDate ? format(initialDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
  const [eventTime, setEventTime] = useState("");
  const [enableReminder, setEnableReminder] = useState(false);
  const [reminderDays, setReminderDays] = useState(1);
  const [reminderTimes, setReminderTimes] = useState<string[]>(["09:00"]);
  const [newReminderTime, setNewReminderTime] = useState("09:00"); // State for adding new reminder time
  const [notificationChannels, setNotificationChannels] = useState<string[]>(["email"]);
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [whatsappRecipients, setWhatsappRecipients] = useState<string[]>([]);
  const [smsRecipients, setSmsRecipients] = useState<string[]>([]);

  // Update event date when initialDate prop changes
  useEffect(() => {
    if (initialDate) {
      setEventDate(format(initialDate, 'yyyy-MM-dd'));
    }
  }, [initialDate]);

  const createEventMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create event");
      return response.json();
    },
    // Optimistic update - add event immediately to UI
    onMutate: async (newEvent) => {
      // Create optimistic event with temporary ID
      const optimisticEvent = {
        id: generateTempId(),
        title: newEvent.title,
        dueDate: new Date(newEvent.eventDate),
        category: 'Event',
        status: newEvent.status,
        entityType: 'event' as const,
      };
      
      // Use reusable optimistic create utility
      const context = await optimisticCreate(queryClient, optimisticEvent);
      
      // Close modal immediately for instant feedback
      handleClose();
      
      return context;
    },
    onSuccess: () => {
      // Show success toast
      toast({
        title: "Event Created",
        description: "Your event has been added to the calendar",
      });
    },
    onError: (error: Error, newEvent, context) => {
      // Rollback on error using utility
      if (context?.previousData) {
        rollbackCalendarQueries(queryClient, context.previousData);
      }
      
      // Show error toast
      toast({
        title: "Error",
        description: error.message || "Failed to create event",
        variant: "destructive",
      });
    },
    // Always refetch to sync with server
    onSettled: () => {
      invalidateCalendarQueries(queryClient);
    },
  });

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setEventDate(format(new Date(), 'yyyy-MM-dd'));
    setEventTime("");
    setEnableReminder(false);
    setReminderDays(1);
    setReminderTimes(["09:00"]);
    setNewReminderTime("09:00"); // Reset new reminder time input
    setNotificationChannels(["email"]);
    setEmailRecipients([]);
    setWhatsappRecipients([]);
    setSmsRecipients([]);
    onClose();
  };

  // Handler functions for recipients
  const handleAddEmailRecipient = (email: string) => {
    const trimmedEmail = email.trim();
    
    if (!trimmedEmail) {
      return;
    }
    
    // Strict email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    
    // Check for duplicates
    if (emailRecipients.includes(trimmedEmail)) {
      toast({
        title: "Duplicate Email",
        description: "This email has already been added",
        variant: "destructive",
      });
      return;
    }
    
    setEmailRecipients([...emailRecipients, trimmedEmail]);
  };

  const handleRemoveEmailRecipient = (email: string) => {
    setEmailRecipients(emailRecipients.filter(e => e !== email));
  };

  const handleAddWhatsAppRecipient = (number: string) => {
    const trimmedNumber = number.trim();
    if (trimmedNumber && !whatsappRecipients.includes(trimmedNumber)) {
      setWhatsappRecipients([...whatsappRecipients, trimmedNumber]);
    }
  };

  const handleRemoveWhatsAppRecipient = (number: string) => {
    setWhatsappRecipients(whatsappRecipients.filter(n => n !== number));
  };

  const handleAddSmsRecipient = (number: string) => {
    const trimmedNumber = number.trim();
    if (trimmedNumber && !smsRecipients.includes(trimmedNumber)) {
      setSmsRecipients([...smsRecipients, trimmedNumber]);
    }
  };

  const handleRemoveSmsRecipient = (number: string) => {
    setSmsRecipients(smsRecipients.filter(n => n !== number));
  };

  const handleAddReminderTime = (time: string) => {
    if (time && !reminderTimes.includes(time)) {
      setReminderTimes([...reminderTimes, time]);
      setNewReminderTime("09:00"); // Reset to default after adding
    }
  };

  const handleRemoveReminderTime = (time: string) => {
    if (reminderTimes.length > 1) {
      setReminderTimes(reminderTimes.filter(t => t !== time));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast({
        title: "Validation Error",
        description: "Event name is required",
        variant: "destructive",
      });
      return;
    }

    // Validate email recipients when email channel is enabled and reminders are enabled
    if (enableReminder && notificationChannels.includes('email')) {
      // Check for uncommitted email input
      const emailInput = document.querySelector('[data-testid="input-email-recipient"]') as HTMLInputElement;
      if (emailInput && emailInput.value.trim()) {
        toast({
          title: "Uncommitted Email",
          description: "You have typed an email but haven't added it. Press Enter or click + to add it.",
          variant: "destructive",
        });
        return;
      }
      
      // Require at least one email recipient
      if (emailRecipients.length === 0) {
        toast({
          title: "Email Recipients Required",
          description: "Please add at least one email recipient by pressing Enter or clicking the + button",
          variant: "destructive",
        });
        return;
      }
    }

    const eventData = {
      title: title.trim(),
      description: description.trim() || null,
      eventDate,
      eventTime: eventTime || null,
      status: "upcoming",
      reminderDays: enableReminder ? reminderDays : 0,
      reminderTimes: enableReminder ? reminderTimes : ["09:00"],
      notificationChannels,
      emailRecipients: emailRecipients,
      whatsappRecipients: whatsappRecipients,
      smsRecipients: smsRecipients,
    };

    createEventMutation.mutate(eventData);
  };

  const toggleNotificationChannel = (channel: string) => {
    setNotificationChannels(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Add Quick Event
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Event Name */}
          <div>
            <Label htmlFor="title">Event Name *</Label>
            <Input
              id="title"
              placeholder="Team Meeting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eventDate">Date *</Label>
              <Input
                id="eventDate"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Time (Optional)</Label>
              <TimePicker12H
                value={eventTime}
                onChange={setEventTime}
                placeholder="Select time"
                data-testid="input-event-time"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              placeholder="Discuss Q4 planning"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Set Reminder */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="reminder"
                checked={enableReminder}
                onCheckedChange={(checked) => setEnableReminder(checked as boolean)}
              />
              <Label htmlFor="reminder" className="cursor-pointer">Set Reminder</Label>
            </div>
            
            {enableReminder && (
              <>
                <div>
                  <Label htmlFor="reminderDays">Remind me (days before)</Label>
                  <Input
                    id="reminderDays"
                    type="number"
                    min="1"
                    value={reminderDays}
                    onChange={(e) => setReminderDays(parseInt(e.target.value) || 1)}
                  />
                </div>

                {/* Reminder Times */}
                <div className="space-y-2">
                  <Label>Reminder Time(s)</Label>
                  <div className="flex gap-2 items-start">
                    <div className="flex-1">
                      <TimePicker12H
                        value={newReminderTime}
                        onChange={setNewReminderTime}
                        placeholder="Select time"
                        data-testid="input-reminder-time"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="button-add-reminder-time"
                      onClick={() => {
                        if (newReminderTime) {
                          handleAddReminderTime(newReminderTime);
                        }
                      }}
                      className="mt-0"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {reminderTimes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {reminderTimes.map((time) => (
                        <Badge key={time} variant="secondary" className="flex items-center gap-1">
                          {convert24To12Hour(time)}
                          {reminderTimes.length > 1 && (
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => handleRemoveReminderTime(time)}
                            />
                          )}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Click + to add multiple reminder times
                  </p>
                </div>

                {/* Notification Channels */}
                <div>
                  <Label>Notification Channels</Label>
                  <div className="flex gap-4 mt-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="email"
                        checked={notificationChannels.includes("email")}
                        onCheckedChange={() => toggleNotificationChannel("email")}
                      />
                      <Label htmlFor="email" className="cursor-pointer">Email</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="whatsapp"
                        checked={notificationChannels.includes("whatsapp")}
                        onCheckedChange={() => toggleNotificationChannel("whatsapp")}
                      />
                      <Label htmlFor="whatsapp" className="cursor-pointer">WhatsApp</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="sms"
                        checked={notificationChannels.includes("sms")}
                        onCheckedChange={() => toggleNotificationChannel("sms")}
                      />
                      <Label htmlFor="sms" className="cursor-pointer">SMS</Label>
                    </div>
                  </div>
                </div>

                {/* Email Recipients */}
                {notificationChannels.includes("email") && (
                  <div className="space-y-2">
                    <Label className="mb-2 block">Email Recipients *</Label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="Enter email address"
                        data-testid="input-email-recipient"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const input = e.target as HTMLInputElement;
                            handleAddEmailRecipient(input.value);
                            input.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] min-w-[44px]"
                        data-testid="button-add-email"
                        onClick={() => {
                          const input = document.querySelector('[data-testid="input-email-recipient"]') as HTMLInputElement;
                          if (input) {
                            handleAddEmailRecipient(input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {emailRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {emailRecipients.map((email) => (
                          <Badge key={email} variant="secondary" className="flex items-center gap-1">
                            {email}
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => handleRemoveEmailRecipient(email)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Press Enter or click the + button to add one or more email addresses
                    </p>
                  </div>
                )}

                {/* WhatsApp Recipients */}
                {notificationChannels.includes("whatsapp") && (
                  <div className="space-y-2">
                    <Label>WhatsApp Numbers (Optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="tel"
                        placeholder="Enter phone number with country code"
                        data-testid="input-whatsapp-recipient"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const input = e.target as HTMLInputElement;
                            handleAddWhatsAppRecipient(input.value);
                            input.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] min-w-[44px]"
                        data-testid="button-add-whatsapp"
                        onClick={() => {
                          const input = document.querySelector('[data-testid="input-whatsapp-recipient"]') as HTMLInputElement;
                          if (input) {
                            handleAddWhatsAppRecipient(input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {whatsappRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {whatsappRecipients.map((number) => (
                          <Badge key={number} variant="secondary" className="flex items-center gap-1">
                            {number}
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => handleRemoveWhatsAppRecipient(number)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Press Enter or click + to add
                    </p>
                  </div>
                )}

                {/* SMS Recipients */}
                {notificationChannels.includes("sms") && (
                  <div className="space-y-2">
                    <Label>SMS Numbers (Optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="tel"
                        placeholder="Enter phone number with country code"
                        data-testid="input-sms-recipient"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const input = e.target as HTMLInputElement;
                            handleAddSmsRecipient(input.value);
                            input.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] min-w-[44px]"
                        data-testid="button-add-sms"
                        onClick={() => {
                          const input = document.querySelector('[data-testid="input-sms-recipient"]') as HTMLInputElement;
                          if (input) {
                            handleAddSmsRecipient(input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {smsRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {smsRecipients.map((number) => (
                          <Badge key={number} variant="secondary" className="flex items-center gap-1">
                            {number}
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => handleRemoveSmsRecipient(number)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Press Enter or click + to add
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Buttons */}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createEventMutation.isPending}>
              {createEventMutation.isPending ? "Creating..." : "Create Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

