import { describe, expect, it } from "vitest";
import { candidateFiles, rippleCandidates, routePattern, routesOf, type Source } from "./ripple.js";

const src = (files: Record<string, string>): Source => ({ files: Object.keys(files), read: (p) => files[p] });

const dotnet = src({
  "src/Shop/Orders/OrderService.cs": `namespace Shop.Orders;
public class OrderService : IOrderService
{
    public OrderService(IConfiguration configuration) { _limit = configuration["OrderLimits:Max"]; }
    [Authorize(Roles = "Manager")]
    public void Cancel(int id) { }
}`,
  "src/Shop/Orders/IOrderService.cs": "namespace Shop.Orders;\npublic interface IOrderService { void Cancel(int id); }",
  "src/Shop/Orders/Order.cs": "namespace Shop.Orders;\npublic class Order { public int Id { get; set; } }",
  "src/Shop/Orders/OrdersEndpoints.cs": `public static class OrdersEndpoints {
    public static void Map(WebApplication app) {
        app.MapPost("/api/orders/{id}/cancel", (int id, OrderService s) => s.Cancel(id));
    }
}`,
  "src/Shop/Program.cs": "builder.Services.AddScoped<IOrderService, OrderService>();",
  "src/Shop/Data/ShopDb.cs": "public class ShopDb : DbContext { public DbSet<Order> Orders { get; set; } }",
  "src/Shop/Data/OrderConfig.cs": "public class OrderConfig : IEntityTypeConfiguration<Order> { }",
  "src/Shop/Migrations/20260101_Init.cs": "migrationBuilder.CreateTable(name: \"Orders\"); // Order",
  "src/Shop/Reports/Sales.cs": "var sql = \"SELECT * FROM Orders WHERE Total > 0\";",
  "src/Shop/Billing/Refunds.cs": "public class Refunds { public Refunds(IOrderService orders) { } }",
  "src/Shop/Pages/Orders.cshtml": "@model OrderService",
  "src/Shop/appsettings.json": "{ \"OrderLimits\": { \"Max\": 5 }, \"Other\": 1 }",
  "tests/Shop.Tests/OrderServiceTests.cs": "public class OrderServiceTests { [Fact] public void Cancels() { var s = new OrderService(null); } }",
  "tests/Shop.Tests/AuthTests.cs": "Assert.True(user.IsInRole(\"Manager\"));",
  "src/Shop/bin/Debug/OrderService.cs": "public class OrderService {}",
  "web/src/api.ts": "export const cancel = (id: string) => fetch(`/api/orders/${id}/cancel`, { method: \"POST\" });",
  "web/src/other.ts": "fetch('/api/customers')",
});

describe("ripple code layer: .NET", () => {
  const r = rippleCandidates(dotnet, [{ path: "src/Shop/Orders/OrderService.cs" }, { path: "src/Shop/Orders/OrdersEndpoints.cs" }]);
  const where = (lens: keyof typeof r.lenses) => r.lenses[lens].map((c) => `${c.path}:${c.kind}`);

  it("finds what the seeds declare, implement, serve and read", () => {
    expect(r.symbols).toEqual(expect.arrayContaining(["OrderService", "OrdersEndpoints"]));
    expect(r.routes).toEqual(["/api/orders/{id}/cancel"]);
    expect(r.settings).toEqual(["OrderLimits"]);
    expect(r.roles).toEqual(["Manager"]);
  });

  it("callers: DI registration direct, interface users as hop 2; seeds and bin/ skipped", () => {
    expect(where("callers")).toContain("src/Shop/Program.cs:di");
    expect(r.lenses.callers.find((c) => c.path === "src/Shop/Billing/Refunds.cs")).toMatchObject({ hop: 2, kind: "interface", seed: "IOrderService" });
    const files = candidateFiles(r);
    expect(files).not.toContain("src/Shop/Orders/OrderService.cs");
    expect(files.some((f) => f.includes("/bin/"))).toBe(false);
  });

  it("screens: the frontend call to the changed route (param normalised) and the Razor page; not other routes", () => {
    expect(where("screens")).toEqual(expect.arrayContaining(["web/src/api.ts:route-call", "src/Shop/Pages/Orders.cshtml:razor"]));
    expect(where("screens")).not.toContain("web/src/other.ts:route-call");
  });

  it("tests: tests of the changed type, the setting in appsettings, the role", () => {
    expect(where("tests")).toEqual(expect.arrayContaining(["tests/Shop.Tests/OrderServiceTests.cs:test", "src/Shop/appsettings.json:setting", "tests/Shop.Tests/AuthTests.cs:role"]));
    expect(r.lenses.tests.filter((c) => c.kind === "setting").map((c) => c.seed)).toEqual(["OrderLimits"]);
  });

  it("data: DbSet, entity config, migration and raw SQL for a changed entity", () => {
    const d = rippleCandidates(dotnet, [{ path: "src/Shop/Orders/Order.cs" }]);
    expect(d.entities).toEqual(["Order"]);
    expect(d.lenses.data.map((c) => `${c.path}:${c.kind}`)).toEqual(expect.arrayContaining([
      "src/Shop/Data/ShopDb.cs:dbset", "src/Shop/Data/OrderConfig.cs:entity-config", "src/Shop/Migrations/20260101_Init.cs:migration", "src/Shop/Reports/Sales.cs:sql"]));
  });

  it("a REMOVED seed marks whatever still uses it as breaks, and breaks rank first", () => {
    const b = rippleCandidates(dotnet, [{ path: "src/Shop/Orders/OrderService.cs", removed: true }, { path: "src/Shop/Orders/OrdersEndpoints.cs", removed: true }]);
    expect(b.lenses.callers[0]).toMatchObject({ breaks: true, seed: "OrderService" });
    expect(b.lenses.screens.find((c) => c.path === "web/src/api.ts")!.breaks).toBe(true);
    expect(r.lenses.callers.every((c) => !c.breaks)).toBe(true);
  });

  it("seed symbols name types without a seed file of their own; unknown seed paths are ignored", () => {
    const s = rippleCandidates(dotnet, [{ path: "gone.cs", symbol: "IOrderService.Cancel" }]);
    expect(s.symbols).toEqual(["IOrderService"]);
    expect(candidateFiles(s)).toEqual(expect.arrayContaining(["src/Shop/Program.cs", "src/Shop/Billing/Refunds.cs", "src/Shop/Orders/OrderService.cs"]));
  });
});

describe("ripple code layer: extension methods", () => {
  it("callers of a static extension class are found by method name, internal or public", () => {
    const ext = src({
      "src/Api/Extensions/OpenApiExtensions.cs": "internal static class Extensions {\n  public static IServiceCollection AddOpenApiDocs(this IServiceCollection s) => s;\n  private static void Helper(int x) {}\n}",
      "src/Api/Program.cs": "builder.Services.AddOpenApiDocs();",
      "src/Api/Other.cs": "Helper(1);",
    });
    const r = rippleCandidates(ext, [{ path: "src/Api/Extensions/OpenApiExtensions.cs" }]);
    expect(r.symbols).toEqual(["AddOpenApiDocs"]);
    expect(candidateFiles(r)).toEqual(["src/Api/Program.cs"]);
  });
});

describe("ripple code layer: Next.js", () => {
  const next = src({
    "app/api/users/[id]/route.ts": "export async function GET() {}",
    "app/users/[id]/page.tsx": "const r = await fetch(`/api/users/${params.id}`);",
    "components/UserCard.tsx": "export function UserCard() { return useSWR('/api/users/' + id) }",
    "components/List.tsx": "import { UserCard } from './UserCard'; <UserCard />",
    "components/__tests__/UserCard.test.tsx": "import { UserCard } from '../UserCard'; render(<UserCard />)",
  });

  it("a name imported from another module is not a caller", () => {
    const r = rippleCandidates(src({
      "lib/session.ts": "export async function getSession() {}",
      "app/page.tsx": "import { getSession } from \"@/lib/session\"\nconst s = await getSession()",
      "lib/auth.ts": "import { getSession } from \"next-auth/react\"\nconst s = await getSession()",
    }), [{ path: "lib/session.ts" }]);
    expect(candidateFiles(r)).toEqual(["app/page.tsx"]);
  });

  it("route handlers by path, callers by export name, tests by folder", () => {
    expect(routesOf("app/api/users/[id]/route.ts", "")).toEqual(["/api/users/[id]"]);
    const r = rippleCandidates(next, [{ path: "app/api/users/[id]/route.ts" }, { path: "components/UserCard.tsx" }]);
    expect(r.lenses.screens.map((c) => c.path)).toEqual(["app/users/[id]/page.tsx"]);
    expect(r.lenses.callers.map((c) => c.path)).toEqual(["components/List.tsx"]);
    expect(r.lenses.tests.map((c) => c.path)).toEqual(["components/__tests__/UserCard.test.tsx"]);
  });
});

describe("routes", () => {
  it("controller attributes with [controller], groups, and params of every style", () => {
    expect(routesOf("A.cs", `[Route("api/[controller]")] public class OrdersController { [HttpGet("{id}")] public X Get(int id) {} }`)).toEqual(["/api/Orders/{id}"]);
    expect(routesOf("A.cs", `var g = app.MapGroup("/api/v1"); g.MapGet("items", h);`)).toEqual(expect.arrayContaining(["/api/v1/items"]));
    const re = routePattern("/api/Orders/{id}")!;
    expect(re.test("fetch(`/api/orders/${id}`)")).toBe(true);
    expect(re.test("fetch('/api/orders/7?x=1')")).toBe(true);
    expect(re.test("fetch('/api/orders')")).toBe(false);
    expect(re.test("fetch('/api/orders/7/lines')")).toBe(false);
    expect(routePattern("/api")).toBeUndefined();
  });
});
