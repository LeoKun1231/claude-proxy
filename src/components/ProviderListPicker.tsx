import { cn } from '@/lib/utils';

export interface ProviderListItem {
    value: string;
    label: string;
    description?: string;
}

interface ProviderListPickerProps {
    items: ProviderListItem[];
    value: string;
    onValueChange: (value: string) => void;
}

export default function ProviderListPicker({
    items,
    value,
    onValueChange,
}: ProviderListPickerProps) {
    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((item) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        onClick={() => onValueChange(item.value)}
                        className={cn(
                            'flex min-h-16 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors',
                            active
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-background/70 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                        )}
                    >
                        <span className="text-sm font-medium leading-none">{item.label}</span>
                        {item.description && (
                            <span className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                {item.description}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
