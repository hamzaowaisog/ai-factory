// The API side of a full-stack product starts from this skeleton (the factory has no .NET scaffold of its own yet): a .NET 9
// minimal API with its PostgreSQL database (src/fullstack/database.ts), one passing test, and a build
// that writes the API's OpenAPI document, which the contract gate reads (src/gates/contract.ts). Nothing here is product code:
// a run adds the routes the contract names.
export const API_SOLUTION = "App.sln";
export const API_BUILT_DOC = "App.Api/openapi/built.json";
export const API_SDK_IMAGE = "mcr.microsoft.com/dotnet/sdk:9.0";
export const API_PORT = 5080;
/** The product's PostgreSQL: the image the lab and the run files start, and the login of the run files' own database. */
export const POSTGRES_IMAGE = "postgres:16-alpine";
export const POSTGRES_LOCAL = { host: "localhost", port: 5432, name: "app", user: "app", password: "app" };
const connection = (host: string) => `Host=${host};Port=${POSTGRES_LOCAL.port};Database=${POSTGRES_LOCAL.name};Username=${POSTGRES_LOCAL.user};Password=${POSTGRES_LOCAL.password}`;
/** The connection string the app reads as ConnectionStrings__App, for a database on `host`. */
export const postgresConnection = connection;

/**
 * Sample rows for a person trying the product: the API run fills SEED_FILE, and the app runs it at startup only when SEED_SETTING
 * is true. The run files set it (src/fullstack/apps.ts); the tests and the lab never do, so they start on an empty database.
 */
export const SEED_FILE = "App.Api/SeedData.cs";
export const SEED_SETTING = "Seed__Demo";
/** The web app's address the API lets in, when it is not the usual one: read by the skeleton's Program.cs as Cors:Origin. */
export const CORS_SETTING = "Cors__Origin";
export const CORS_KEY = "Cors:Origin";
export const apiSeed = (body: string) => `namespace App.Api;

// Sample rows for a person trying the product. The app calls Run at startup, after the tables exist, only when the setting
// Seed:Demo is true (the factory's run files set it; tests never do). Add rows to a table only when that table is empty.
public static class SeedData
{
    public static void Run(AppDb db)
    {
${body}    }
}
`;

export const HEALTH_LINE = 'app.MapGet("/", () => "API is up").ExcludeFromDescription();';
export const apiProgram = (routes: string) => `using App.Api;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();
// PostgreSQL: the connection comes from ConnectionStrings__App and nowhere else. There is no built-in login: an app that is
// not given one stops when it first needs the database, so it can never run on a password that is written in the code.
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("App")
    ?? throw new InvalidOperationException("No database connection is configured. Set ConnectionStrings__App (for example Host=...;Port=5432;Database=...;Username=...;Password=...).")));
// the web app's address: 3000 unless the setting Cors:Origin names another (the factory sets it when it starts the web app on another port)
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(builder.Configuration["Cors:Origin"] ?? "http://localhost:3000").AllowAnyHeader().AllowAnyMethod()));
var app = builder.Build();
// Create the database with every table when the app starts. The build also runs this file, to write the API's OpenAPI
// document, and must not touch the database then. Keep this: the factory starts the app and reads the database it creates.
if (System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name != "GetDocument.Insider")
{
    // one at a time: the tests start several copies of the app in one process, and two creating the tables at once collide
    lock (typeof(AppDb))
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Database.EnsureCreated();
        // sample rows, only when asked for (Seed__Demo=true): tests and the factory's own checks start on an empty database
        if (app.Configuration.GetValue<bool>("Seed:Demo")) SeedData.Run(db);
    }
}
app.UseCors();
${HEALTH_LINE}
${routes}
app.Run();

public partial class Program { }
`;
export const apiDb = (body: string) => `using Microsoft.EntityFrameworkCore;

namespace App.Api;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
${body}}
`;
/** The API repo at its first commit: path -> content. The contract file joins it once the web run's plan is approved. */
export const API_SKELETON: Record<string, string> = {
  "App.sln": `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "App.Api", "App.Api\\App.Api.csproj", "{7B0C1A52-3D4E-4F60-9A11-2B3C4D5E6F70}"
EndProject
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "App.Tests", "App.Tests\\App.Tests.csproj", "{8C1D2B63-4E5F-4071-AB22-3C4D5E6F7081}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{7B0C1A52-3D4E-4F60-9A11-2B3C4D5E6F70}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{7B0C1A52-3D4E-4F60-9A11-2B3C4D5E6F70}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{8C1D2B63-4E5F-4071-AB22-3C4D5E6F7081}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{8C1D2B63-4E5F-4071-AB22-3C4D5E6F7081}.Debug|Any CPU.Build.0 = Debug|Any CPU
	EndGlobalSection
EndGlobal
`,
  "App.Api/App.Api.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <!-- the build writes the API's OpenAPI document here; the factory compares it with contracts/openapi.yaml -->
    <OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/openapi</OpenApiDocumentsDirectory>
    <OpenApiGenerateDocumentsOptions>--file-name built</OpenApiGenerateDocumentsOptions>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.0" />
    <PackageReference Include="Microsoft.Extensions.ApiDescription.Server" Version="9.0.0">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="9.0.2" />
  </ItemGroup>
</Project>
`,
  "App.Api/Program.cs": apiProgram(""),
  "App.Api/AppDb.cs": apiDb(""),
  [SEED_FILE]: apiSeed(""),
  "App.Tests/App.Tests.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="9.0.0" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../App.Api/App.Api.csproj" />
  </ItemGroup>
</Project>
`,
  "App.Tests/HealthTests.cs": `using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace App.Tests;

public class HealthTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public HealthTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task ApiIsUp()
    {
        var res = await _factory.CreateClient().GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}
`,
  // only the built document: `openapi/` alone also hides a source folder named OpenApi/ on a Mac
  ".gitignore": "bin/\nobj/\nopenapi/*.json\n",
};

