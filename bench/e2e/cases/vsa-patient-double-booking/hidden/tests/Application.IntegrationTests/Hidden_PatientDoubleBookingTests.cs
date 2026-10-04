// Hidden acceptance tests for an end-to-end eval case (bench/e2e). HTTP and JSON only: they never use the
// application's own types, so any implementation that keeps the stated contract passes.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace VerticalSliceArchitecture.Application.IntegrationTests;

public class Hidden_PatientDoubleBookingTests : IClassFixture<CustomWebApplicationFactory>
{
    private const string John = "11111111-1111-1111-1111-111111111111";
    private const string Jane = "22222222-2222-2222-2222-222222222222";
    private const string Bob = "33333333-3333-3333-3333-333333333333";
    private const string FamilyMedicine = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private const string Cardiology = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    private readonly HttpClient _client;

    public Hidden_PatientDoubleBookingTests(CustomWebApplicationFactory factory) => _client = factory.CreateClient();

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
    public async Task OverlappingPatientBookingReturns409()
    {
        await BookOk(Bob, FamilyMedicine, At(70, 10));
        var res = await Book(Bob, Cardiology, At(70, 10, 15));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task BackToBackBookingIsAllowed()
    {
        await BookOk(Bob, FamilyMedicine, At(71, 10));
        Assert.Equal(HttpStatusCode.Created, (await Book(Bob, Cardiology, At(71, 10, 30))).StatusCode);
    }

    [Fact]
    public async Task CancelledAppointmentDoesNotBlock()
    {
        var id = await BookOk(Bob, FamilyMedicine, At(72, 10));
        Assert.Equal(HttpStatusCode.OK, (await Cancel(id, "Patient asked")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Book(Bob, Cardiology, At(72, 10))).StatusCode);
    }
}
