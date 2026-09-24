import { RegisterPageTitle } from "@/components/layout/page-title";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  // On a narrow phone, several buttons wrapping to 2-3 rows pushes the page
  // content down further than a scroll costs -- one row that scrolls
  // sideways (like the tab bars elsewhere) keeps the header a fixed height.
  // -mx-3/px-3 lets that row's scroll area bleed to the screen edge, matching
  // the workspace's own edge padding, so swiping doesn't feel clipped.
  //
  // The title and description themselves move into the app bar on a phone
  // (RegisterPageTitle publishes them), because the bar is otherwise empty
  // there and the vertical space is better spent on the actual work.
  return (
    <>
      <RegisterPageTitle title={title} description={description} />
      <div className="mb-3 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-sm:hidden">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:shrink-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">{actions}</div> : null}
      </div>
    </>
  );
}
