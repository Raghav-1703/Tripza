"use client";

import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, Building, GraduationCap, Hospital, ShoppingBag, Train } from "lucide-react";
import { searchLocations, LocationSearchResult } from "@/lib/locationSearch";

export interface LocationSuggestion {
  name: string;
  lat: number;
  lon: number;
  category?: string;
  subtitle?: string;
}

interface LocationInputProps {
  id?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect?: (loc: LocationSuggestion) => void;
  required?: boolean;
  className?: string;
}

function getCategoryIcon(category?: string) {
  switch (category) {
    case "shopping":
      return <ShoppingBag className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />;
    case "hospital":
      return <Hospital className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />;
    case "residential":
      return <Building className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />;
    case "transport":
      return <Train className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />;
    case "education":
      return <GraduationCap className="h-4 w-4 mt-0.5 shrink-0 text-purple-500" />;
    default:
      return <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />;
  }
}

export function LocationInput({
  id,
  placeholder,
  value,
  onChange,
  onSelect,
  required,
  className,
}: LocationInputProps) {
  const [suggestions, setSuggestions] = useState<LocationSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [lastFetchedQuery, setLastFetchedQuery] = useState("");

  const wrapperRef = useRef<HTMLDivElement>(null);
  const isSelecting = useRef(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let isMounted = true;

    // If the user selected an item, the parent updates the value prop.
    // Skip fetching and reset the flag.
    if (isSelecting.current) {
      isSelecting.current = false;
      return;
    }

    if (!value || value.trim().length < 2) {
      setSuggestions([]);
      setHasError(false);
      setIsLoading(false);
      setLastFetchedQuery(value);
      return;
    }

    const fetchSuggestions = async () => {
      setIsLoading(true);
      setHasError(false);
      try {
        const results = await searchLocations(value, { limit: 8 });
        if (isMounted) {
          setSuggestions(results);
          setLastFetchedQuery(value);
          setIsOpen(true);
        }
      } catch (err) {
        console.error("Failed to fetch location suggestions", err);
        if (isMounted) {
          setSuggestions([]);
          setHasError(true);
          setLastFetchedQuery(value);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchSuggestions, 250);

    return () => {
      isMounted = false;
      clearTimeout(debounceTimer);
    };
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleSelect = (item: LocationSearchResult) => {
    isSelecting.current = true;
    onChange(item.name);

    if (onSelect) {
      onSelect({
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        category: item.category,
        subtitle: item.subtitle,
      });
    }

    setIsOpen(false);
  };

  const isSync = lastFetchedQuery === value;
  const showNoResults = isOpen && value.trim().length >= 2 && !isLoading && isSync && suggestions.length === 0;

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={handleInputChange}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        required={required}
        autoComplete="off"
      />

      {isLoading && (
        <div className="absolute right-3 top-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md max-h-72 overflow-y-auto">
          <ul className="py-1 divide-y divide-border/40">
            {suggestions.map((s, idx) => (
              <li
                key={`${s.name}-${s.lat}-${s.lon}-${idx}`}
                onClick={() => handleSelect(s)}
                className="px-3.5 py-2 hover:bg-muted/70 cursor-pointer text-sm flex items-start gap-2.5 transition-colors"
              >
                {getCategoryIcon(s.category)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="font-medium text-foreground truncate">{s.name}</p>
                    {s.isLocal && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                        Talegaon
                      </span>
                    )}
                  </div>
                  {s.subtitle && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{s.subtitle}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showNoResults && (
        <div className="absolute z-50 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md">
          <div className="px-4 py-3 text-sm text-muted-foreground text-center">
            {hasError ? "Search failed. Please try again." : "No places found."}
          </div>
        </div>
      )}
    </div>
  );
}
