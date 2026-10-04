// Hidden acceptance tests for an end-to-end eval case (bench/e2e). HTTP and JSON only: they never use the
// application's own types, so any implementation that keeps the stated contract passes.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace VerticalSliceArchitecture.Application.IntegrationTests;

public class Hidden_StateConflict409Tests : IClassFixture<CustomWebApplicationFactory>
{
    private const string John = "11111111-1111-1111-1111-111111111111";
    private const string Jane = "22222222-2222-2222-2222-222222222222";
    private const string Bob = "33333333-3333-3333-3333-333333333333";
    private const string FamilyMedicine = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private const string Cardiology = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    private readonly HttpClient _client;

    public Hidden_StateConflict409Tests(CustomWebApplicationFactory factory) => _client = factory.CreateClient();

    private static DateTimeOffset At(int days, int hour, int minute = 0) =>
        new(DateTime.UtcNow.Date.AddDays(days).AddHours(hour).AddMinutes(minute), TimeSpan.Zero);

    private Task<HttpResponseMessage> Book(string patient, string doctor, DateTimeOffset start, int minutes = 30) =>
        _client.PostAsJsonAsync("/api/appointments", new { patientId = patient, doctorId = doctor, start, end = start.AddMinutes(minutes), notes = (string?)null });

    private async Task<string> BookOk(string patient, string doctor, DateTimeOffset start, int minutes = 30)
    {
        var res = await Book(patient, doctor, start, minutes);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private Task<HttpResponseMessage> Cancel(string id, string reason) =>
        _client.PostAsJsonAsync($"/api/appointments/{id}/cancel", new { appointmentId = id, reason });

    private Task<HttpResponseMessage> Complete(string id) =>
        _client.PostAsJsonAsync($"/api/appointments/{id}/complete", new { appointmentId = id, notes = (string?)null });

    [Fact]
    public async Task CancelCompletedReturns409()
    {
        var id = await BookOk(Jane, Cardiology, At(60, 10));
        Assert.Equal(HttpStatusCode.OK, (await Complete(id)).StatusCode);
        var res = await Cancel(id, "Patient asked");
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Contains("Cannot cancel a completed appointment", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task CompleteCancelledReturns409()
    {
        var id = await BookOk(Jane, FamilyMedicine, At(61, 10));
        Assert.Equal(HttpStatusCode.OK, (await Cancel(id, "Patient asked")).StatusCode);
        var res = await Complete(id);
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Contains("Cannot complete a cancelled appointment", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task EmptyReasonStillReturns400()
    {
        var id = await BookOk(Jane, Cardiology, At(62, 10));
        Assert.Equal(HttpStatusCode.OK, (await Complete(id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Cancel(id, "")).StatusCode);
    }
}
