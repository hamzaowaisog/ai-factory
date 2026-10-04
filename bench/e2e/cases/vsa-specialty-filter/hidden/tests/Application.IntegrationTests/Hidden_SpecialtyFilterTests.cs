// Hidden acceptance tests for an end-to-end eval case (bench/e2e). HTTP and JSON only: they never use the
// application's own types, so any implementation that keeps the stated contract passes.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace VerticalSliceArchitecture.Application.IntegrationTests;

public class Hidden_SpecialtyFilterTests : IClassFixture<CustomWebApplicationFactory>
{
    private const string John = "11111111-1111-1111-1111-111111111111";
    private const string Jane = "22222222-2222-2222-2222-222222222222";
    private const string Bob = "33333333-3333-3333-3333-333333333333";
    private const string FamilyMedicine = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private const string Cardiology = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    private readonly HttpClient _client;

    public Hidden_SpecialtyFilterTests(CustomWebApplicationFactory factory) => _client = factory.CreateClient();

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

    private async Task<List<JsonElement>> List(string query)
    {
        var res = await _client.GetAsync($"/api/appointments?pageSize=100&{query}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().ToList();
    }

    private static string DoctorOf(JsonElement a) => a.GetProperty("doctorId").GetString()!;
    private static string IdOf(JsonElement a) => a.GetProperty("id").GetString()!;

    [Fact]
    public async Task FiltersBySpecialty()
    {
        var heart = await BookOk(John, Cardiology, At(80, 10));
        var family = await BookOk(Jane, FamilyMedicine, At(80, 11));
        var items = await List("specialty=Cardiology");
        Assert.Contains(items, a => IdOf(a) == heart);
        Assert.DoesNotContain(items, a => IdOf(a) == family);
        Assert.All(items, a => Assert.Equal(Cardiology, DoctorOf(a)));
    }

    [Fact]
    public async Task SpecialtyIsCaseInsensitive()
    {
        var heart = await BookOk(John, Cardiology, At(81, 10));
        var family = await BookOk(Jane, FamilyMedicine, At(81, 11));
        var items = await List("specialty=cardiology");
        Assert.Contains(items, a => IdOf(a) == heart);
        Assert.DoesNotContain(items, a => IdOf(a) == family);
        Assert.All(items, a => Assert.Equal(Cardiology, DoctorOf(a)));
    }

    [Fact]
    public async Task UnknownSpecialtyReturnsEmptyList()
    {
        await BookOk(John, Cardiology, At(82, 10));
        await BookOk(Jane, FamilyMedicine, At(82, 11));
        Assert.Empty(await List("specialty=Dentistry"));
    }

    [Fact]
    public async Task CombinesWithStatusFilter()
    {
        var cancelled = await BookOk(Bob, Cardiology, At(83, 10));
        Assert.Equal(HttpStatusCode.OK, (await Cancel(cancelled, "Patient asked")).StatusCode);
        var otherCancelled = await BookOk(Jane, FamilyMedicine, At(83, 10));
        Assert.Equal(HttpStatusCode.OK, (await Cancel(otherCancelled, "Patient asked")).StatusCode);
        var scheduled = await BookOk(Bob, Cardiology, At(83, 11));
        var items = await List("specialty=Cardiology&status=Cancelled");
        Assert.Contains(items, a => IdOf(a) == cancelled);
        Assert.DoesNotContain(items, a => IdOf(a) == scheduled);
        Assert.DoesNotContain(items, a => IdOf(a) == otherCancelled);
    }
}
