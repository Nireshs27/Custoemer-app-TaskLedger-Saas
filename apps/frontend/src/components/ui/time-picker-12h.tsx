import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TimePicker12HProps {
  value?: string; // Format: "HH:MM" (24-hour)
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function TimePicker12H({ 
  value, 
  onChange, 
  placeholder = "Select time", 
  className,
  disabled = false,
  "data-testid": dataTestId 
}: TimePicker12HProps) {
  const [hour12, setHour12] = useState("9");
  const [minute, setMinute] = useState("00");
  const [period, setPeriod] = useState("AM");

  // Convert 24-hour time to 12-hour format when value prop changes
  useEffect(() => {
    if (value && value.includes(':')) {
      const [hour24Str, minuteStr] = value.split(':');
      const hour24 = parseInt(hour24Str);
      const minute = parseInt(minuteStr);
      
      if (hour24 === 0) {
        setHour12("12");
        setPeriod("AM");
      } else if (hour24 < 12) {
        setHour12(hour24.toString());
        setPeriod("AM");
      } else if (hour24 === 12) {
        setHour12("12");
        setPeriod("PM");
      } else {
        setHour12((hour24 - 12).toString());
        setPeriod("PM");
      }
      
      setMinute(minuteStr.padStart(2, '0'));
    }
  }, [value]);

  // Convert 12-hour format to 24-hour and call onChange
  const updateTime = (newHour12?: string, newMinute?: string, newPeriod?: string) => {
    const h12 = newHour12 || hour12;
    const m = newMinute || minute;
    const p = newPeriod || period;
    
    let hour24 = parseInt(h12);
    
    if (p === "AM" && hour24 === 12) {
      hour24 = 0;
    } else if (p === "PM" && hour24 !== 12) {
      hour24 += 12;
    }
    
    const formattedTime = `${hour24.toString().padStart(2, '0')}:${m}`;
    onChange(formattedTime);
  };

  const handleHourChange = (newHour: string) => {
    setHour12(newHour);
    updateTime(newHour, minute, period);
  };

  const handleMinuteChange = (newMinute: string) => {
    setMinute(newMinute);
    updateTime(hour12, newMinute, period);
  };

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    updateTime(hour12, minute, newPeriod);
  };

  // Generate hour options (1-12)
  const hourOptions = Array.from({ length: 12 }, (_, i) => (i + 1).toString());
  
  // Generate minute options (00, 15, 30, 45)
  const minuteOptions = ["00", "15", "30", "45"];

  const displayTime = () => {
    if (value) {
      return `${hour12}:${minute} ${period}`;
    }
    return placeholder;
  };

  const disabledStyles = disabled ? "opacity-50 pointer-events-none" : "";

  return (
    <div
      className={`flex items-center gap-2 w-full ${disabledStyles} ${className ?? ""}`}
      data-testid={dataTestId}
    >
      {/* Hour selector */}
      <Select value={hour12} onValueChange={handleHourChange} disabled={disabled}>
        <SelectTrigger className="flex-1 min-w-0 sm:w-16" disabled={disabled}>
          <SelectValue placeholder="12" />
        </SelectTrigger>
        <SelectContent>
          {hourOptions.map(hour => (
            <SelectItem key={hour} value={hour}>
              {hour}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span>:</span>

      {/* Minute selector */}
      <Select value={minute} onValueChange={handleMinuteChange} disabled={disabled}>
        <SelectTrigger className="flex-1 min-w-0 sm:w-16" disabled={disabled}>
          <SelectValue placeholder="00" />
        </SelectTrigger>
        <SelectContent>
          {minuteOptions.map(min => (
            <SelectItem key={min} value={min}>
              {min}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* AM/PM selector */}
      <Select value={period} onValueChange={handlePeriodChange} disabled={disabled}>
        <SelectTrigger className="flex-1 min-w-0 sm:w-16" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export default TimePicker12H;