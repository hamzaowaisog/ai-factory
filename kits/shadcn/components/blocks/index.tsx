// @client
// Every block the design can use, by its type. A screen names its blocks directly; this is for code that holds a block as data.
import { AccordionBlock } from "./accordion";
import { ActionsBlock } from "./actions";
import { AlertBlock } from "./alert";
import { CalendarBlock } from "./calendar";
import { CardsBlock } from "./cards";
import { CarouselBlock } from "./carousel";
import { ChartBlock } from "./chart";
import { ChatBlock } from "./chat";
import { CompareBlock } from "./compare";
import { DetailBlock } from "./detail";
import { FiltersBlock } from "./filters";
import { FormBlock } from "./form";
import { GalleryBlock } from "./gallery";
import { KanbanBlock } from "./kanban";
import { ListBlock } from "./list";
import { MapBlock } from "./map";
import { NotificationsBlock } from "./notifications";
import { PlansBlock } from "./plans";
import { ProgressBlock } from "./progress";
import { ReceiptBlock } from "./receipt";
import { ResultsBlock } from "./results";
import { ReviewsBlock } from "./reviews";
import { StatsBlock } from "./stats";
import { StepsBlock } from "./steps";
import { TableBlock } from "./table";
import { TextBlock } from "./text";
import { TimelineBlock } from "./timeline";
import { ToolbarBlock } from "./toolbar";
import { UploadBlock } from "./upload";
import type { Block, BlockEvents } from "./types";

export * from "./types";
export {
  AccordionBlock, ActionsBlock, AlertBlock, CalendarBlock, CardsBlock, CarouselBlock, ChartBlock, ChatBlock, CompareBlock, DetailBlock, FiltersBlock, FormBlock, GalleryBlock,
  KanbanBlock, ListBlock, MapBlock, NotificationsBlock, PlansBlock, ProgressBlock, ReceiptBlock, ResultsBlock, ReviewsBlock, StatsBlock, StepsBlock, TableBlock, TextBlock,
  TimelineBlock, ToolbarBlock, UploadBlock,
};

export function BlockView({ block, ...ev }: { block: Block } & BlockEvents) {
  switch (block.type) {
    case "stats": return <StatsBlock {...block} {...ev} />;
    case "filters": return <FiltersBlock {...block} {...ev} />;
    case "table": return <TableBlock {...block} {...ev} />;
    case "form": return <FormBlock {...block} {...ev} />;
    case "chart": return <ChartBlock {...block} {...ev} />;
    case "cards": return <CardsBlock {...block} {...ev} />;
    case "carousel": return <CarouselBlock {...block} {...ev} />;
    case "steps": return <StepsBlock {...block} {...ev} />;
    case "timeline": return <TimelineBlock {...block} {...ev} />;
    case "detail": return <DetailBlock {...block} {...ev} />;
    case "accordion": return <AccordionBlock {...block} {...ev} />;
    case "list": return <ListBlock {...block} {...ev} />;
    case "calendar": return <CalendarBlock {...block} {...ev} />;
    case "map": return <MapBlock {...block} {...ev} />;
    case "gallery": return <GalleryBlock {...block} {...ev} />;
    case "upload": return <UploadBlock {...block} {...ev} />;
    case "chat": return <ChatBlock {...block} {...ev} />;
    case "kanban": return <KanbanBlock {...block} {...ev} />;
    case "plans": return <PlansBlock {...block} {...ev} />;
    case "reviews": return <ReviewsBlock {...block} {...ev} />;
    case "notifications": return <NotificationsBlock {...block} {...ev} />;
    case "results": return <ResultsBlock {...block} {...ev} />;
    case "compare": return <CompareBlock {...block} {...ev} />;
    case "receipt": return <ReceiptBlock {...block} {...ev} />;
    case "actions": return <ActionsBlock {...block} {...ev} />;
    case "alert": return <AlertBlock {...block} {...ev} />;
    case "toolbar": return <ToolbarBlock {...block} {...ev} />;
    case "progress": return <ProgressBlock {...block} {...ev} />;
    case "text": return <TextBlock {...block} {...ev} />;
  }
}
