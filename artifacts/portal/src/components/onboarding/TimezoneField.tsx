import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  US_TIMEZONES,
  OTHER_TIMEZONE_VALUE,
  mapToUsTimezone,
  getAllTimezones,
} from "@/lib/us-timezones";

interface TimezoneFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Friendly US-first timezone picker (Task #1684). Shows the seven canonical
 * US options with plain-language labels; selecting "Other / International"
 * reveals a searchable full-IANA list so non-US members aren't stranded. The
 * stored value is always the underlying IANA identifier.
 */
export function TimezoneField({ value, onChange }: TimezoneFieldProps) {
  const canonicalUsValue = mapToUsTimezone(value);
  const isUs = canonicalUsValue !== null;
  const [otherOpen, setOtherOpen] = useState(!isUs && !!value);
  const allTimezones = useMemo(() => getAllTimezones(), []);

  const selectValue = isUs ? canonicalUsValue : OTHER_TIMEZONE_VALUE;

  const handleSelectChange = (next: string) => {
    if (next === OTHER_TIMEZONE_VALUE) {
      setOtherOpen(true);
      return;
    }
    setOtherOpen(false);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <Select value={selectValue} onValueChange={handleSelectChange}>
        <SelectTrigger data-testid="timezone-select-trigger">
          <SelectValue placeholder="Select a timezone" />
        </SelectTrigger>
        <SelectContent>
          {US_TIMEZONES.map((tz) => (
            <SelectItem key={tz.value} value={tz.value}>
              {tz.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={OTHER_TIMEZONE_VALUE}>Other / International</SelectItem>
        </SelectContent>
      </Select>

      {(otherOpen || !isUs) && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              data-testid="timezone-other-trigger"
              className="w-full justify-between font-normal"
            >
              {!isUs && value ? value.replace(/_/g, " ") : "Search timezones..."}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search timezone..." />
              <CommandList>
                <CommandEmpty>No timezone found.</CommandEmpty>
                <CommandGroup>
                  {allTimezones.map((tz) => (
                    <CommandItem
                      key={tz}
                      value={tz}
                      onSelect={() => onChange(tz)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === tz ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {tz.replace(/_/g, " ")}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
