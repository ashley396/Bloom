import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormActions,
  FormDescription,
  FormField,
  FormMessage,
  FormRow,
  Input,
  Label,
  SectionHeader,
  Select,
  Separator,
  Skeleton,
  SurfaceCard,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components/ui";

const swatches = [
  { name: "Warm cream", className: "bg-warm-cream" },
  { name: "Warm white", className: "bg-warm-white ring-1 ring-florisyn-border" },
  { name: "Blush 500", className: "bg-blush-500" },
  { name: "Sage pale", className: "bg-sage-pale" },
  { name: "Sage ink", className: "bg-sage-ink" },
  { name: "Charcoal", className: "bg-charcoal" },
  { name: "Success", className: "bg-success" },
  { name: "Warning", className: "bg-warning" },
  { name: "Destructive", className: "bg-destructive" },
];

export function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="page-container section-stack max-w-5xl">
      <header>
        <p className="text-label mb-2">Florisyn UI</p>
        <h1 className="text-display-md">Design system</h1>
        <p className="mt-3 max-w-2xl text-body-sm text-charcoal-muted">
          Reusable tokens and components for page redesigns. Reference route — not linked from production nav.
        </p>
      </header>

      <section>
        <SectionHeader
          eyebrow="Foundation"
          title="Color palette"
          description="Warm floral neutrals with blush primary and sage secondary accents."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {swatches.map((swatch) => (
            <SurfaceCard key={swatch.name} padding="sm" className="flex flex-col gap-3">
              <div className={["h-14 rounded-xl", swatch.className].join(" ")} />
              <p className="text-caption">{swatch.name}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Typography" description="Serif display headings with DM Sans body text." />
        <SurfaceCard className="space-y-4">
          <p className="text-display-lg">Display large</p>
          <p className="text-display-md">Display medium</p>
          <p className="text-heading-lg">Heading large</p>
          <p className="text-heading-md">Heading medium</p>
          <p className="text-heading-sm">Heading small</p>
          <p className="text-body">Body — 15px relaxed copy for florist workflows and daily operations.</p>
          <p className="text-body-sm text-charcoal-muted">Body small — secondary descriptions and helper text.</p>
          <p className="text-label">Label uppercase</p>
        </SurfaceCard>
      </section>

      <section>
        <SectionHeader title="Buttons" />
        <SurfaceCard className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link action</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </SurfaceCard>
      </section>

      <section>
        <SectionHeader title="Badges" />
        <SurfaceCard className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="primary" dot>
            Primary
          </Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
        </SurfaceCard>
      </section>

      <section>
        <SectionHeader title="Cards" />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Composable card</CardTitle>
              <CardDescription>CardHeader, CardContent, and CardFooter for structured layouts.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body-sm text-charcoal-muted">Use for dashboards, settings panels, and detail views.</p>
            </CardContent>
          </Card>
          <SurfaceCard interactive padding="md">
            <p className="text-heading-sm">Surface card</p>
            <p className="mt-2 text-body-sm text-charcoal-muted">Quick wrapper with optional interactive lift.</p>
          </SurfaceCard>
        </div>
      </section>

      <section>
        <SectionHeader title="Forms" />
        <SurfaceCard>
          <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
            <FormRow>
              <FormField>
                <Label htmlFor="ds-shop" required>
                  Shop name
                </Label>
                <Input id="ds-shop" placeholder="Rose & Stem Florals" />
                <FormDescription>Visible on receipts and customer communications.</FormDescription>
              </FormField>
              <FormField>
                <Label htmlFor="ds-plan">Plan</Label>
                <Select id="ds-plan" defaultValue="professional">
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="premium">Premium</option>
                </Select>
              </FormField>
            </FormRow>
            <FormField>
              <Label htmlFor="ds-notes">Internal notes</Label>
              <Textarea id="ds-notes" placeholder="Delivery preferences, design notes…" />
              <FormMessage>Example validation message</FormMessage>
            </FormField>
            <FormField className="flex flex-row items-start gap-3">
              <Checkbox id="ds-active" defaultChecked />
              <div className="grid gap-1.5">
                <Label htmlFor="ds-active">Active shop</Label>
                <FormDescription>Inactive shops are hidden from the default workspace switcher.</FormDescription>
              </div>
            </FormField>
            <FormActions>
              <Button type="submit">Save changes</Button>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </FormActions>
          </form>
        </SurfaceCard>
      </section>

      <section>
        <SectionHeader title="Alerts" />
        <div className="grid gap-3">
          <Alert>
            <AlertTitle>Default alert</AlertTitle>
            <AlertDescription>Neutral informational messaging for low-priority notices.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <AlertDescription>Order #1042 marked ready for delivery.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertDescription>Low stock on garden roses — reorder suggested.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertDescription>Payment capture failed. Review the transaction in Payments.</AlertDescription>
          </Alert>
        </div>
      </section>

      <section>
        <SectionHeader title="Table" />
        <Table>
          <TableCaption>Recent orders sample data</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">#1042</TableCell>
              <TableCell>Harper Lane</TableCell>
              <TableCell>
                <Badge variant="primary" dot>
                  Designing
                </Badge>
              </TableCell>
              <TableCell className="text-right">$186.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">#1041</TableCell>
              <TableCell>Studio Bloom Events</TableCell>
              <TableCell>
                <Badge variant="success">Delivered</Badge>
              </TableCell>
              <TableCell className="text-right">$420.00</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <SectionHeader title="Tabs" />
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <SurfaceCard padding="sm">Overview tab panel content.</SurfaceCard>
          </TabsContent>
          <TabsContent value="timeline">
            <SurfaceCard padding="sm">Timeline tab panel content.</SurfaceCard>
          </TabsContent>
          <TabsContent value="notes">
            <SurfaceCard padding="sm">Notes tab panel content.</SurfaceCard>
          </TabsContent>
        </Tabs>
      </section>

      <section>
        <SectionHeader title="Dialog" />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm archive</DialogTitle>
              <DialogDescription>
                This listing will be hidden from the marketplace. You can restore it later from archived items.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setDialogOpen(false)}>
                Archive
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <section>
        <SectionHeader title="Loading & separators" />
        <SurfaceCard className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
          <Separator />
          <p className="text-caption">Skeleton placeholders for async content regions.</p>
        </SurfaceCard>
      </section>
    </div>
  );
}
