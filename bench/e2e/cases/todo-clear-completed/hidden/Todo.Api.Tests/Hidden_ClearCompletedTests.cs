// Hidden acceptance tests for an end-to-end eval case (bench/e2e). HTTP and JSON only, through the repo's own
// test host; they never use the application's own types, so any implementation that keeps the stated contract passes.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TodoApi.Tests;

public class Hidden_ClearCompletedTests
{
    private static async Task<List<string>> Titles(HttpClient client) =>
        (await client.GetFromJsonAsync<JsonElement>("/todos")).EnumerateArray().Select(t => t.GetProperty("title").GetString()!).OrderBy(t => t).ToList();

    private static async Task Seed(TodoApplication app, string user, params (string title, bool done)[] todos)
    {
        await app.CreateUserAsync(user);
        var client = app.CreateClient(user);
        foreach (var (title, done) in todos)
        {
            var res = await client.PostAsJsonAsync("/todos", new { title });
            var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
            if (done) Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/todos/{id}", new { id, title, isComplete = true })).StatusCode);
        }
    }

    [Fact]
    public async Task ClearsOnlyCompletedTodos()
    {
        await using var app = new TodoApplication();
        await using var db = app.CreateTodoDbContext();
        await Seed(app, "51", ("done one", true), ("open one", false));
        var client = app.CreateClient("51");
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync("/todos/completed")).StatusCode);
        Assert.Equal(["open one"], await Titles(client));
    }

    [Fact]
    public async Task LeavesOtherUsersTodos()
    {
        await using var app = new TodoApplication();
        await using var db = app.CreateTodoDbContext();
        await Seed(app, "52", ("mine done", true));
        await Seed(app, "53", ("theirs done", true));
        Assert.Equal(HttpStatusCode.OK, (await app.CreateClient("52").DeleteAsync("/todos/completed")).StatusCode);
        Assert.Equal(["theirs done"], await Titles(app.CreateClient("53")));
    }

    [Fact]
    public async Task AdminClearsOnlyOwn()
    {
        await using var app = new TodoApplication();
        await using var db = app.CreateTodoDbContext();
        await Seed(app, "54", ("admin done", true));
        await Seed(app, "55", ("user done", true));
        var admin = app.CreateClient("54", isAdmin: true);
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync("/todos/completed")).StatusCode);
        Assert.Equal(["user done"], await Titles(app.CreateClient("55")));
        Assert.Empty(await Titles(app.CreateClient("54")));
    }

    [Fact]
    public async Task ReturnsDeletedCount()
    {
        await using var app = new TodoApplication();
        await using var db = app.CreateTodoDbContext();
        await Seed(app, "56", ("a", true), ("b", true), ("c", false));
        var res = await app.CreateClient("56").DeleteAsync("/todos/completed");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(2, (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("deleted").GetInt32());
    }
}
