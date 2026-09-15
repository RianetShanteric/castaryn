import { Select } from "@radix-ui/themes";

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type AppSelectProps = {
  value: string;
  options: AppSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

const emptyValue = "__castaryn_empty_value__";

export function AppSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className,
  placeholder,
}: AppSelectProps) {
  return (
    <Select.Root
      value={value || emptyValue}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === emptyValue ? "" : nextValue)
      }
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={["app-select", className].filter(Boolean).join(" ")}
        placeholder={placeholder}
      />
      <Select.Content className="app-select__content" position="popper">
        {options.map((option) => (
          <Select.Item
            key={option.value || emptyValue}
            value={option.value || emptyValue}
            disabled={option.disabled}
            className="app-select__item"
          >
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
