interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function PageHeader({ title, description, icon }: PageHeaderProps) {
  return (
    <div>
      {icon ? (
        <div className="flex items-center gap-3">
          {icon}
          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        </div>
      ) : (
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
      )}
      {description && (
        <p className="text-muted-foreground mt-2">{description}</p>
      )}
    </div>
  );
}
