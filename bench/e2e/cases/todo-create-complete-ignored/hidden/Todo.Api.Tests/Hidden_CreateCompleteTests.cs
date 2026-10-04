// Hidden acceptance tests for an end-to-end eval case (bench/e2e). HTTP and JSON only, through the repo's own
// test host; they never use the application's own types, so any implementation that keeps the stated contract passes.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TodoApi.Tests;

public class Hidden_CreateCompleteTests
{
    private static async Task<JsonElement> Single(HttpClient client)
    {
        var todos = await client.GetFromJsonAsync<JsonElement>("/todos");
        return Assert.Single(todos.EnumerateArray().ToList());
    }

    [Fact]
    public async Task PostWithIsCompleteTrueIsStoredComplete()
    {
        await using var app = new TodoApplication();
        await using var db = app.CreateTodoDbContext();
        await app.CreateUserAsync("41");
        var client = app.CreateClient("41");
        var res = await client.PostAsJsonAsync("/todos", new { title = "Imported, already done", isComplete = true });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.True((await Single(client)).GetProperty("isComplete").GetBoolean());
    }

    [Fact]
    public async Task PostWithoutIsCompleteDefaultsToFalse()
    {
        await using var app = new TodoApplication();
        await using var db = app.CreateTodoDbContext();
        await app.CreateUserAsync("42");
        var client = app.CreateClient("42");
        var res = await client.PostAsJsonAsync("/todos", new { title = "Still to do" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.False((await Single(client)).GetProperty("isComplete").GetBoolean());
    }
}
