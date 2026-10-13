# Approval: Employees can sign in using their Folio3 Google account, with employee

Run 20261013-folio3-parking-app-introductio-c0aa · risk **high** · feature · size L · cost so far $0.03

## Your request (word for word, from typed prompt)
> Folio3 Parking App
> 
> Introduction
> 
> Folio3 has a fixed number of parking spaces available at its office premises, while the number of
> employees commuting to the office by car is greater than the available parking capacity.
> Dedicated parking spaces are currently assigned to employees based on defined organizational criteria,
> including seniority, designation, and other relevant factors. Employees with dedicated parking are issued
> a vehicle sticker, allowing security personnel to identify vehicles that are authorized to enter and use the
> office parking area.
> 
> However, dedicated parking spaces often remain unused when the assigned employee is on leave,
> working from home, travelling, or otherwise not visiting the office. At the same time, other employees
> who commute by car may be required to park outside the office despite parking spaces being
> temporarily available inside the premises.
> 
> To improve the utilization of available parking spaces, Folio3 plans to introduce a mobile application
> through which employees with dedicated parking can release their parking space when they do not
> intend to use it. The released spaces can then be made available to other eligible employees through a
> transparent and controlled process.
> 
> The application will be available on both iOS and Android platforms.
> 
> Problem Statement
> 
> The current parking allocation process does not provide visibility into whether an assigned
> parking space will be used on a particular day.
> 
> As a result:
> 
> ● Dedicated parking spaces may remain vacant for the entire day.
> ● Employees without dedicated parking may have to park on nearby roads.
> ● Security personnel do not have real-time information about released or temporarily
> reassigned parking spaces.
> ● Parking availability is managed through informal communication or is not managed at all.
> ● The organization is unable to measure parking demand, utilization, or recurring
> availability.
> 
> A centralized parking management application is required to enable parking holders to release
> unused spaces and allow those spaces to be allocated temporarily to other employees.
> 
> Solution Overview
> 
> The proposed solution will consist of a mobile application available for both iOS and Android,
> supported by a centralized backend system and a camera-based vehicle verification system at
> the office entrance.
> 
> Employees will log in using their Folio3 Google account (Gmail). The system will automatically
> identify the employee and retrieve their profile information using their corporate email address.
> 
> For employees with dedicated parking, the system will already maintain information such as:
> 
> ● Employee ID
> ● Employee Name
> ● Assigned Parking Status
> ● Registered Vehicle License Plate Number
> 
> Employees using the application for the first time who do not have a registered vehicle will be
> prompted to enter their vehicle's license plate number. This information will be stored for future
> parking requests.
> 
> By default, the system will assume that employees with dedicated parking will use their
> assigned parking space on each working day. If they do not intend to come to the office, they
> can release their parking space through a single action in the mobile application for the current
> day or schedule future releases using a calendar for up to 30 days.
> 
> Once a parking space is released, it becomes available to employees without dedicated
> parking. Eligible employees will receive a push notification and can claim the available space on
> a first-come, first-served basis.
> 
> At the office entrance, vehicles with permanent parking stickers will continue to follow the
> existing process. Vehicles without stickers will be verified using a license plate recognition
> camera. The system will validate the vehicle against the temporary parking allocation for that
> day and, if authorized, activate a green indicator for the security guard to allow entry.
> 
> User Roles
> 
> Dedicated Parking Holder
> 
> An employee with a permanently assigned parking space who can release their parking when it
> will not be used.
> 
> Temporary Parking User
> 
> An employee without a dedicated parking space who can claim an available parking spot on a
> first-come, first-served basis.
> 
> Security Guard
> 
> A security staff member responsible for verifying vehicle entry based on parking stickers or
> system authorization.
> 
> Parking Administrator
> 
> An authorized administrator responsible for managing parking assignments, employee records,
> system configuration, and parking reports.
> 
> User Stories
> 
> US-001: Login with Folio3 Account
> 
> User Story
> 
> As an employee, I want to sign in using my Folio3 Google account so that I can securely access
> the parking management application.
> 
> Description
> 
> The application shall support authentication using Folio3 Google Workspace accounts only.
> Personal Gmail accounts or other email providers shall not be permitted.
> 
> Upon successful login, the system shall identify the employee using their corporate email
> address and retrieve their profile information.
> 
> For employees with dedicated parking, the system shall automatically import and maintain the
> following information:
> 
> ● Employee ID
> ● Employee Name
> ● Assigned Parking Status
> ● One or more registered vehicle license plate numbers
> ● Assigned parking floor
> ● Vehicle make
> ● Vehicle model
> 
> ● Vehicle color
> 
> Employees without dedicated parking will be required to complete their vehicle profile during
> their first login by registering at least one license plate number. The remaining employee
> information shall be retrieved automatically from the corporate directory.
> 
> Acceptance Criteria
> 
> ● Employee can log in using a Folio3 Google account.
> ● Only authorized Folio3 employees can access the application.
> ● Employees with dedicated parking have their profile populated automatically after login.
> ● A dedicated parking holder may have one or more registered vehicles.
> ● Employees without dedicated parking are prompted to register at least one vehicle
> during their first login.
> ● A vehicle profile includes the license plate number and optionally the vehicle make,
> model, and color.
> ● Returning users are taken directly to the application dashboard after successful
> authentication.
> 
> S-002: Release Parking for Today
> 
> User Story
> 
> As an employee with a dedicated parking space, I want to release my parking for the current
> day with a single tap so that another employee can use it if I am not coming to the office.
> 
> Description
> 
> Employees with dedicated parking shall be able to release their assigned parking space for the
> current day directly from the home screen.
> 
> The action should require a single tap (with an optional confirmation prompt) to make the
> process quick and convenient. Once the parking is released, the space shall immediately
> become available for temporary allocation to other eligible employees on a first-come,
> first-served basis.
> 
> If the parking space has already been claimed by another employee, the dedicated parking
> holder will no longer have access to that parking space for the remainder of the day.
> 
> The application shall clearly display the current status of the parking space (e.g., Reserved,
> Released, or Claimed by Another Employee).
> 
> Acceptance Criteria
> 
> ● Only employees with dedicated parking can access this feature.
> ● The option to "Release Today's Parking" is available on the home screen.
> ● Releasing today's parking requires a single user action.
> ● Once released, the parking space is immediately made available to eligible employees.
> ● The parking status is updated in real time.
> ● The user receives a confirmation that the parking has been released successfully.
> ● The user cannot release the same parking space multiple times for the same day.
> ● If the parking has already been claimed by another employee, the user is informed that
> the parking cannot be reclaimed for that day without administrator intervention.
> 
> US-003: Schedule Future Parking Release
> 
> User Story
> 
> As an employee with a dedicated parking space, I want to schedule the release of my parking
> for future dates so that my parking space can be utilized by others when I know I will not be
> coming to the office.
> 
> Description
> 
> The application shall provide a calendar interface that allows dedicated parking holders to
> release their parking for future dates, up to 30 days in advance.
> 
> Users may select individual dates or multiple dates from the calendar. Once scheduled, the
> parking space will automatically become available for temporary allocation on the selected
> dates.
> 
> The user may cancel a scheduled parking release at any time, provided the parking space has
> not already been claimed by another employee. If the parking has already been allocated, the
> release cannot be reverted without administrator intervention.
> 
> Acceptance Criteria
> ● Only employees with dedicated parking can access this feature.
> ● A calendar view is available to schedule future parking releases.
> ● Users can release parking for any date within the next 30 days.
> ● Users can select one or multiple dates.
> ● Scheduled releases are saved and displayed on the calendar.
> ● Users can cancel a scheduled release if the parking has not yet been claimed.
> ● If the parking has already been claimed, the user is informed that the release cannot be
> reverted.
> ● The system maintains an audit trail of all scheduled releases and cancellations.
> 
> US-004: Claim Available Parking
> 
> User Story
> 
> As an employee without a dedicated parking space, I want to claim an available parking spot so
> that I can park inside the office premises when a space becomes available.
> 
> Description
> 
> Parking spaces shall be allocated on a first-come, first-served basis.
> 
> Parking spaces released in advance through the planning calendar shall become available for
> claiming at the Daily Parking Release Time (default: 8:00 AM, configurable by the
> administrator).
> 
> If a dedicated parking holder releases their parking on the same day:
> 
> ● If the release occurs before the Daily Parking Release Time, the parking space shall
> become available at the Daily Parking Release Time.
> ● If the release occurs after the Daily Parking Release Time, the parking space shall
> become available immediately.
> 
> Whenever one or more parking spaces become available, eligible employees without dedicated
> parking shall receive a push notification.
> 
> The application shall display the total number of available parking spaces (e.g., 5 Parking
> Spots Available). Employees will not select a specific parking space. Upon successfully
> claiming a parking spot, the system shall automatically allocate one of the available parking
> spaces and inform the employee of the assigned parking floor.
> 
> The application will not validate whether the employee actually parks on the assigned floor.
> Floor allocation is intended only to distribute vehicles evenly across available parking areas.
> 
> Acceptance Criteria
> 
> ● Only employees without dedicated parking can claim available parking.
> ● Parking spaces are allocated on a first-come, first-served basis.
> ● Pre-scheduled parking releases become available at the Daily Parking Release Time.
> ● Same-day releases made before the Daily Parking Release Time become available at
> the Daily Parking Release Time.
> ● Same-day releases made after the Daily Parking Release Time become available
> immediately.
> ● Eligible employees receive a push notification when parking becomes available.
> ● The application displays the number of currently available parking spaces.
> ● A parking space can only be claimed once.
> 
> ● Upon a successful claim, the system automatically assigns a parking space and displays
> the allocated parking floor.
> ● The application records the date, time, employee, and assigned parking for audit
> purposes.
> ● The application does not enforce or verify whether the employee parks on the assigned
> floor.
> 
> US-005: Verify Vehicle at Parking Entrance
> 
> User Story
> 
> As a security guard, I want the system to automatically verify vehicles entering the parking area
> so that only authorized vehicles are allowed to enter.
> 
> Description
> 
> The parking entrance shall be equipped with a License Plate Recognition (LPR) camera and a
> status indicator light.
> 
> The camera shall continuously monitor approaching vehicles and identify their license plate
> numbers. The system shall ignore pedestrians, motorcycles, and other non-car objects.
> 
> For each detected vehicle, the system shall verify whether it has a valid parking authorization for
> the current day.
> 
> The operational flow shall be as follows:
> 
> ● Vehicles displaying a permanent Folio3 parking sticker will continue to follow the existing
> process and will not be stopped by the security guard, even if the parking holder had
> previously released their parking through the application.
> ● Vehicles without a permanent parking sticker shall be stopped by the security guard.
> ● The system shall verify the detected license plate against the temporary parking
> allocation for the current day.
> ● If a valid parking authorization exists, the system shall activate the green indicator light.
> ● Upon seeing the green light, the security guard shall allow the vehicle to enter.
> ● If no valid authorization exists, the indicator light shall remain off and the vehicle shall not
> be permitted to enter.
> 
> All successful and unsuccessful verification attempts shall be recorded for audit and reporting
> purposes.
> 
> Acceptance Criteria
> 
> ● The camera detects approaching cars and reads their license plate numbers.
> ● The system ignores pedestrians, motorcycles, and other non-car objects.
> 
> ● Vehicles with permanent parking stickers are not required to undergo system verification.
> ● Vehicles without parking stickers are verified against the day's parking allocations.
> ● The green indicator light is activated only when a valid parking authorization exists.
> ● The indicator light remains off when no valid authorization is found.
> ● The system records the date, time, license plate number, verification result, and entry
> status for every verification attempt.
> 
> US-006: Track Parking Utilization and Generate Weekly Reports
> 
> User Story
> 
> As a Parking Administrator, I want the system to track parking utilization and identify unused
> parking allocations so that management can monitor parking usage and improve utilization.
> 
> Description
> 
> The system shall use vehicle entry records captured through the License
> Plate Recognition (LPR) camera to determine whether allocated parking
> spaces were actually utilized.
> 
> For Phase 1, the system shall only monitor, record, and report parking
> utilization. No automated penalties or policy enforcement shall be applied.
> 
> The system shall track the following scenarios:
> 
> Scenario 1 – Dedicated Parking Not Utilized
> 
> ● The employee has a dedicated parking space.
> ● The employee did not release their parking for the day.
> ● The employee's registered vehicle was not detected entering the parking facility.
> ● The parking shall be recorded as Unused Dedicated Parking.
> 
> Scenario 2 – Temporary Parking Not Utilized
> 
> ● The employee successfully claimed a temporary parking space.
> ● The employee's registered vehicle was not detected entering the parking facility on that
> day.
> ● The parking shall be recorded as Unused Temporary Parking.
> 
> The system shall maintain a history of these events for reporting and future policy
> implementation.
> 
> A weekly utilization report shall be generated automatically and emailed every Monday
> morning to designated stakeholders.
> 
> The report should include, at a minimum:
> 
> ● Employees with dedicated parking who did not release or utilize their parking.
> ● Employees who claimed temporary parking but did not utilize it.
> ● Daily and weekly parking utilization statistics.
> ● Total number of released parking spaces.
> ● Total number of temporary parking claims.
> ● Overall parking utilization percentage.
> 
> Acceptance Criteria
> 
> ● The system identifies unused dedicated parking based on the absence of a vehicle entry
> record.
> ● The system identifies unused temporary parking based on the absence of a vehicle entry
> record.
> ● All utilization events are stored with the corresponding employee, vehicle, and date.
> ● A weekly parking utilization report is generated automatically every Monday morning.
> ● The report is emailed to the configured stakeholders.
> ● No automated warning, suspension, or penalty is applied in Phase 1.


## Your answers
- Q-1 When an employee with multiple registered vehicles claims temporary parking, which vehicle's plate should be authorized for that day's allocation? → **The employee selects one registered vehicle when claiming; only that plate is authorized for the allocation.**
- Q-2 Which timezone defines “today,” the 30-day scheduling window, the daily release time, and Monday-morning report scheduling? → **Use the office's local timezone for all date boundaries and scheduled times.**
- Q-3 How should the system choose the assigned parking floor when it automatically allocates a claimed space? → **Choose a floor with the most remaining capacity, using a consistent tie-break when floors are equally available.**
- Q-4 Which sources should provide the employee, vehicle, and parking-assignment records, and how should existing records be loaded? → **Use the corporate directory for employee identity and an administrator-maintained parking/vehicle roster for assignments, initially loaded from existing records.**
- Q-5 How long should release, claim, LPR verification, and utilization history be retained? → **Apply Folio3's existing records-retention policy to these histories.**
- Q-6 If a dedicated holder arrives in a vehicle with a permanent parking sticker after releasing their space and another employee has claimed it, which access outcome should apply? → **Honor the permanent sticker holder's entry; the temporary claimant may be denied if the released space is occupied.**
- Q-7 Which dates count as working days for the default dedicated-parking availability and related utilization scenarios? → **Treat Monday through Friday as working days, without excluding holidays.**
- Q-8 What parking information should security guards be able to access beyond the indicator result at the entrance? → **Only use the indicator; do not provide guards with a product screen or parking records.**

## Confirm these assumptions (high risk)
- [ ] ASM-2 What entrance LPR camera and indicator-light integration is available for the app to use? → assumed: Integrate with the existing camera and indicator through their supported interfaces.
- [ ] ASM-3 What should security do if the camera, plate recognition, network, or indicator fails during a temporary-authorization check? → assumed: Keep the automatic authorization indicator off and hold the vehicle for an approved manual verification process.
- [ ] ASM-11 Should LPR record entry detections for vehicles with permanent parking stickers, even though those vehicles bypass temporary-authorization checks? → assumed: Record their plate detections for utilization reporting, but do not use them to authorize or block entry.
- [ ] ASM-12 What LPR camera and indicator system will provide the plate detections and receive authorization results? → assumed: Integrate with an existing LPR camera and indicator system; identify its vendor/interface before implementation.
- [ ] ASM-13 What should security do when LPR, the network connection, or the indicator is unavailable or cannot read a plate? → assumed: Keep the indicator off and deny entry until system verification is restored.
- [ ] ASM-15 Can an employee who claimed temporary parking cancel that claim before using it? → assumed: Temporary claims cannot be canceled by the employee in Phase 1.
- [ ] ASM-16 Should a newly self-registered vehicle plate be immediately eligible for parking authorization, or must it be approved first? → assumed: Activate the plate immediately after the employee registers it.

Other assumptions: ASM-1 How should the app notify eligible employees when parking becomes available, given that native push notifications are out of scope? → assumed: Email only, from fixed templates; no SMS or push.; ASM-4 How should “overall parking utilization percentage” be calculated in the weekly report? → assumed: On-screen lists with filters and CSV export; no custom report builder.; ASM-5 Which product languages should the responsive web app support? → assumed: English only, left to right.; ASM-6 Which browsers should the responsive web app support? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-7 What accessibility conformance level is required for the web app? → assumed: WCAG 2.1 AA on the main flows.; ASM-8 Should parking flows remain available when a user's device has no internet connection? → assumed: No; online only.; ASM-9 Which visual colour modes should the responsive web app provide? → assumed: Light mode only.; ASM-10 What expected employee population and peak simultaneous claim volume should the system support? → assumed: Up to 1,000 users and 100,000 records in the first year.; ASM-14 Since this is a responsive web app rather than a native phone app, how should eligible employees be notified when parking becomes available? → assumed: Email only, from fixed templates; no SMS or push.; ASM-17 How should the overall parking utilization percentage in the weekly report be calculated? → assumed: On-screen lists with filters and CSV export; no custom report builder.; ASM-18 How should the designated weekly report recipients be maintained? → assumed: On-screen lists with filters and CSV export; no custom report builder.

## Requirements
- **REQ-1** (ADDED) The Folio3 parking web app shall authenticate employees only through Folio3 Google Workspace accounts and reject personal Gmail accounts and other non-Folio3 identities.
  - AC-1.1 [api] Given A valid Folio3 Google Workspace identity and a personal Gmail or other non-Folio3 identity are available for sign-in tests; when each identity submits a sign-in request; then the Folio3 identity receives a successful response and each non-Folio3 identity receives a non-success response
  - AC-1.2 [manual] Given An employee has a successful returning-user authentication; when the employee opens the application; then the screen shows the employee dashboard
- **REQ-2** (ADDED) When an employee signs in, the Folio3 parking web app shall require the signed-in Folio3 Google identity to match the corporate email used for that employee's self-service profile lookup, restrict employee and vehicle data to that employee, and permit administrators to access other employee records only under their authorized permissions, while retrieving employee identity from the corporate directory and parking assignments and registered vehicle details from the administrator-maintained roster initially loaded from existing records.
  - AC-2.1 [api] Given The corporate directory and initially loaded parking roster contain an employee, an assigned-parking status, vehicle details, and a corporate email matching the signed-in Folio3 Google identity; when the employee profile is retrieved after sign-in; then the returned profile fields include the employee ID, employee name, assigned-parking status, assigned floor, and registered plate and vehicle details from those sources
  - AC-2.2 [api] Given An administrator adds or updates an employee assignment in the roster; when the employee profile is retrieved; then the returned profile fields reflect the roster update
  - AC-2.3 [api] Given The signed-in Folio3 Google identity does not match the corporate email submitted for the self-service profile lookup; when the employee profile is requested; then the response status is non-success and no employee or vehicle profile fields are returned
  - AC-2.4 [api] Given An authenticated employee requests another employee's profile or vehicle data; when the request is processed; then the response status is non-success and no other employee or vehicle fields are returned
  - AC-2.5 [api] Given An authenticated parking administrator has authorized access to another employee's record; when the administrator retrieves that record; then the response status is successful and the returned fields contain the record permitted by the administrator's permissions
- **REQ-3** (ADDED) If an employee without dedicated parking has no registered vehicle, then the Folio3 parking web app shall require registration of at least one license plate before enabling claims, permit one or more registered plates with optional make, model, and color, and activate each newly registered plate immediately.
  - AC-3.1 [api] Given An employee without dedicated parking has no registered vehicle; when the employee attempts a claim before registering a plate; then the response rejects the claim and the response field identifies vehicle registration as required
  - AC-3.2 [api] Given An employee submits a plate with optional make, model, and color; when the employee registers the vehicle; then the returned vehicle record contains the plate and submitted optional fields, and the plate is eligible for a parking claim
  - AC-3.3 [manual] Given An employee without a registered vehicle opens the first-login flow; when the registration step is shown; then the screen displays a required license-plate registration step
- **REQ-4** (ADDED) The Folio3 parking web app shall treat Monday through Friday as working days, including holidays, when applying default dedicated-parking availability and utilization scenarios.
  - AC-4.1 [api] Given A date range includes Monday through Sunday and a weekday holiday; when the system evaluates default working-day availability; then the returned date values mark Monday through Friday, including the holiday, as working days and Saturday and Sunday as non-working days
- **REQ-5** (ADDED) If a dedicated parking holder releases today's assigned space, then the Folio3 parking web app shall accept the release in one action, reject a duplicate release for that date, and expose the space status as Reserved, Released, or Claimed.
  - AC-5.1 [api] Given An authenticated employee has dedicated parking that is not yet released or claimed today; when the employee submits a release request; then the response confirms the release and the returned status value is Released
  - AC-5.2 [manual] Given A dedicated holder is viewing the home screen and today's parking is reserved; when the holder performs the release action; then the screen shows a single release action and displays the updated parking status
  - AC-5.3 [api] Given Today's assigned space has already been released; when the holder submits another release request for today; then the response rejects the duplicate request and the returned status value remains unchanged
  - AC-5.4 [api] Given A dedicated parking holder, an employee without dedicated parking, and a claimed release are available for authorization tests; when each employee submits a release request; then the response permits the dedicated holder's eligible release and rejects releases by the other employee or for the already-claimed space
- **REQ-6** (ADDED) The Folio3 parking web app shall allow dedicated parking holders to schedule one or more parking releases on dates up to 30 calendar days ahead and display saved releases on a calendar.
  - AC-6.1 [api] Given A dedicated holder selects dates within the next 30 calendar days; when the holder submits a schedule request; then the response contains a saved release record for each selected date
  - AC-6.2 [api] Given A dedicated holder selects a date beyond the 30-day scheduling window; when the holder submits the schedule request; then the response rejects the out-of-window date
  - AC-6.3 [manual] Given A dedicated holder has saved future releases; when the holder opens the release calendar; then the screen displays the saved release dates
- **REQ-7** (ADDED) The Folio3 parking web app shall allow a dedicated parking holder to cancel a scheduled release only while that date's space has not been claimed and record each scheduling and cancellation event.
  - AC-7.1 [api] Given A scheduled release has not been claimed; when the holder cancels it; then the response confirms cancellation and the returned audit list contains both the scheduling and cancellation events
  - AC-7.2 [api] Given A scheduled release has already been claimed; when the holder attempts to cancel it; then the response rejects the cancellation and the returned release record remains claimed
- **REQ-8** (ADDED) The Folio3 parking web app shall use 8:00 AM as the default daily parking release time and allow an administrator to configure that time in the office's local timezone.
  - AC-8.1 [api] Given No administrator has changed the daily release time; when the release-time configuration is read; then the returned value is 8:00 AM in the configured office timezone
  - AC-8.2 [api] Given An administrator submits a new daily release time; when the configuration is saved and read back; then the response confirms the saved time and the returned value matches the configured time
- **REQ-9** (ADDED) The Folio3 parking web app shall evaluate today, the 30-day scheduling window, daily release cutoffs, and weekly report scheduling using the configured office-local timezone.
  - AC-9.1 [api] Given The configured office timezone differs from the test client's timezone and the test clock is near a date boundary; when the system evaluates today's date and the scheduling window; then the response date values match the configured office-local date boundaries
  - AC-9.2 [job] Given A report job is scheduled near the start of Monday in the office timezone; when the job scheduler evaluates its run time; then the job event records a Monday-morning run according to the configured office-local time
- **REQ-10** (ADDED) When a scheduled release reaches the daily release time or a same-day release occurs, the Folio3 parking web app shall make the space claimable at the daily release time for scheduled releases and same-day releases before that time, and immediately for same-day releases after that time.
  - AC-10.1 [api] Given A future release or a same-day release before the configured daily release time is scheduled; when the office-local clock reaches the daily release time; then the availability response includes the released space
  - AC-10.2 [api] Given A dedicated holder releases today's space after the configured daily release time; when the release request completes; then the response indicates that the space is available immediately
- **REQ-11** (ADDED) The Folio3 parking web app shall provide available-space counts and allocate each available space to the first eligible non-dedicated employee whose claim is accepted, allowing each space to be claimed only once.
  - AC-11.1 [api] Given One space is available and two eligible employees submit claims concurrently; when the claim requests are processed; then exactly one response confirms a claim, the other response rejects it, and the returned available-space count is zero
  - AC-11.2 [manual] Given An eligible employee opens the parking availability view; when spaces are available; then the screen displays the current available-space count
  - AC-11.3 [api] Given An employee with dedicated parking submits a temporary-space claim; when the claim request is processed; then the response rejects the claim
- **REQ-12** (ADDED) The Folio3 parking web app shall require an employee claiming temporary parking to select one registered vehicle, authorize only that vehicle's plate for the allocation, and assign a floor with the most remaining capacity using a consistent tie-break when floors have equal remaining capacity.
  - AC-12.1 [api] Given An employee has multiple registered vehicles and an available space exists; when the employee claims the space using one selected vehicle; then the returned allocation record contains the selected plate as the only authorized plate and the assigned floor has the greatest remaining capacity, subject to the configured consistent tie-break
  - AC-12.2 [manual] Given An employee has a successful temporary claim; when the employee views the allocation; then the screen displays the assigned parking floor
  - AC-12.3 [api] Given An employee submits a temporary claim without selecting a registered vehicle; when the claim is processed; then the response rejects the claim and the response field identifies vehicle selection as required
- **REQ-13** (ADDED) When one or more parking spaces become available, the Folio3 parking web app shall send an email notification using a fixed template to eligible employees without dedicated parking.
  - AC-13.1 [api] Given At least one parking space becomes available and eligible non-dedicated employees have email addresses; when the availability notification is processed; then the outbound email-service call contains the eligible recipients and a fixed-template message
- **REQ-14** (ADDED) The Folio3 parking web app shall reject employee cancellation of a temporary parking claim in Phase 1.
  - AC-14.1 [api] Given An employee has an active temporary parking claim; when the employee submits a cancellation request; then the response rejects the request and the returned claim record remains active
- **REQ-15** (ADDED) When the existing entrance LPR camera reports a car plate detection, the Folio3 parking web app shall verify the plate against an active temporary allocation for the office-local date, request green-indicator activation only for valid authorization, and record the attempt's date, time, plate, verification result, and entry status.
  - AC-15.1 [api] Given A detected car plate has a valid temporary allocation for the office-local date; when the entrance verification interface processes the detection; then the verification row records the date, time, plate, authorized verification result, and entry status, the outbound indicator call requests green activation, and the response reports an authorized result
  - AC-15.2 [api] Given A detected car plate has no valid temporary allocation for the office-local date; when the entrance verification interface processes the detection; then the verification row records the date, time, plate, unauthorized verification result, and entry status, the outbound indicator call does not request green activation, and the response reports an unauthorized result
  - AC-15.3 [api] Given The LPR camera reports a pedestrian, motorcycle, or other non-car object; when the detection is processed; then the response contains no parking authorization result and no green-activation call is sent
- **REQ-16** (ADDED) The Folio3 parking web app shall record permanent-sticker vehicle plate detections for utilization, bypass temporary authorization and entry blocking for those vehicles, and, when a permanent holder enters a released space allocated temporarily, cancel that temporary allocation so subsequent verification denies the temporary claimant authorization for that space.
  - AC-16.1 [api] Given A permanent-sticker vehicle detection is received, including when its dedicated holder released the space and another employee claimed it; when the detection is processed; then a detection row is recorded and no temporary-authorization decision or entry-blocking call is made for that vehicle
  - AC-16.2 [manual] Given A security guard checks an entrance result; when the guard-facing surface is accessed; then the screen displays only the indicator result and exposes no parking records or product screen
  - AC-16.3 [api] Given A permanent-sticker holder is detected entering a released space with an active temporary allocation; when the permanent holder's detection is processed; then the permanent-vehicle detection row is recorded and the temporary allocation row has a canceled status
  - AC-16.4 [api] Given A permanent-sticker holder's detected entry has canceled the temporary allocation for the space; when the temporary claimant's plate is processed by the entrance verification interface; then the response reports an unauthorized result and the outbound indicator call does not request green activation
- **REQ-17** (ADDED) If the camera, plate recognition, network, or indicator fails or a plate cannot be read during an entrance check, then the Folio3 parking web app shall record an unsuccessful verification, keep green authorization off, and deny entry until service is restored without offering a manual-verification path.
  - AC-17.1 [api] Given An entrance check encounters a camera, recognition, network, or indicator failure, or an unreadable plate; when the verification interface processes the failure; then the response reports an unsuccessful result with an entry-status field of Denied, the verification row records the failure, no green-activation call is issued, and no manual-verification path is offered
  - AC-17.2 [api] Given Entrance service has been restored and a detected plate has a valid temporary allocation for the office-local date; when the verification interface processes the detection; then the response reports an authorized result and the outbound indicator call requests green activation
- **REQ-18** (ADDED) The Folio3 parking web app shall record an Unused Dedicated Parking event for each working day when a dedicated holder did not release the space and no registered vehicle entry was detected, and an Unused Temporary Parking event when a claimant's selected vehicle was not detected entering on the claim date.
  - AC-18.1 [job] Given A dedicated holder did not release a working-day space and no registered vehicle entry exists for that date; when the utilization evaluation runs; then a utilization row records Unused Dedicated Parking with the employee, vehicle, and date fields
  - AC-18.2 [job] Given An employee claimed temporary parking and the selected vehicle has no entry detection on the claim date; when the utilization evaluation runs; then a utilization row records Unused Temporary Parking with the employee, vehicle, and date fields
  - AC-18.3 [api] Given A permanent-sticker vehicle enters the facility; when its entry detection is processed for utilization; then the detection row is available to the utilization evaluation
- **REQ-19** (ADDED) The Folio3 parking web app shall generate a weekly utilization report every Monday morning in the office timezone containing dedicated employees who neither released nor used their parking, temporary claimants who did not use their parking, daily and weekly utilization statistics, total released spaces, total temporary claims, and an overall utilization percentage.
  - AC-19.1 [job] Given Utilization history exists for the reporting week; when the Monday-morning report job runs; then the generated report file contains the dedicated-unused and temporary-unused employee lists, daily and weekly statistics, released-space count, temporary-claim count, and an overall utilization-percentage field
- **REQ-20** (ADDED) The Folio3 parking web app shall email each weekly utilization report to the designated stakeholders using the configured stakeholder recipient list and permit only authenticated parking administrators to update that list.
  - AC-20.1 [job] Given A weekly report is generated and designated stakeholder email addresses are configured; when the report email job runs; then the outbound email-service call contains the stakeholder recipients and the generated report
  - AC-20.2 [api] Given An authenticated parking administrator changes the designated stakeholder recipient list; when the list is read for the next report; then the returned recipient list contains the updated addresses
  - AC-20.3 [api] Given An authenticated employee who is not a parking administrator submits a stakeholder recipient-list update; when the update request is processed; then the response status is non-success and the returned recipient list remains unchanged
- **REQ-21** (ADDED) The Folio3 parking web app shall not create automated warnings, suspensions, or penalties based on parking utilization in Phase 1.
  - AC-21.1 [job] Given A utilization evaluation identifies unused dedicated or temporary parking; when the evaluation and report jobs run; then no warning, suspension, or penalty row, event, email, or outbound enforcement call is created
- **REQ-22** (ADDED) The Folio3 parking web app shall retain release, claim, LPR verification, and utilization history according to Folio3's existing records-retention policy.
  - AC-22.1 [job] Given A test retention policy is configured for release, claim, LPR verification, and utilization history; when the retention job runs across records both within and beyond the configured retention period; then the row list retains in-period records and removes or archives expired records according to the policy

Checked by a person, not by a test: AC-1.2, AC-3.3, AC-5.2, AC-6.3, AC-11.2, AC-12.2, AC-16.2 (each needs a person's sign-off before delivery)

Not changing: Native iOS or Android applications, app-store distribution, native push notifications, background location, and native home-screen behavior; the product is a responsive web app, with email used for availability notifications (ASM-1, ASM-14).; SMS notifications (ASM-1, ASM-14).; Custom report builder (ASM-4, ASM-17).; Offline parking flows (ASM-8).

## Files the plan will touch (14)
- app/globals.css  ← not found by grounding; check it
- app/layout.tsx  ← not found by grounding; check it
- components/screens/s-1/container.tsx  ← not found by grounding; check it
- components/screens/s-10/container.tsx  ← not found by grounding; check it
- components/screens/s-11/container.tsx  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-4/container.tsx  ← not found by grounding; check it
- components/screens/s-5/container.tsx  ← not found by grounding; check it
- components/screens/s-6/container.tsx  ← not found by grounding; check it
- components/screens/s-7/container.tsx  ← not found by grounding; check it
- components/screens/s-8/container.tsx  ← not found by grounding; check it
- components/screens/s-9/container.tsx  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: OPTION-1 (chosen): Use the generated API client directly from each screen container, keeping integrations and business rules API-side. | OPTION-2: Add an application-owned service wrapper for each feature before connecting screen containers.
Decision: Decision: use the generated API client directly in each screen container.
The API contract is shared with the separate API repository; parking rules and external integrations remain API-side.
The factory-generated routes, frame, navigation, and approved pages remain unchanged.
Use the scaffold's design-system task exactly, then implement one wired screen slice per task.
- TASK-1 Set up the design system → ; builds towards a later task (no criteria of its own)
- TASK-2 Wire Folio3 sign-in → REQ-1, REQ-2; must pass AC-1.1, AC-1.2
- TASK-3 Connect the employee parking home → REQ-2, REQ-4, REQ-5, REQ-8, REQ-10, REQ-11, REQ-13; must pass AC-13.1
- TASK-4 Connect vehicle registration → REQ-2, REQ-3, REQ-12; builds towards a later task (no criteria of its own)
- TASK-5 Connect scheduled parking releases → REQ-4, REQ-6, REQ-7, REQ-8, REQ-9; must pass AC-6.1, AC-6.2, AC-6.3
- TASK-6 Connect temporary-space claiming → REQ-3, REQ-10, REQ-11, REQ-12; must pass AC-3.1, AC-3.2, AC-3.3, AC-10.1, AC-10.2, AC-11.1, AC-11.2, AC-11.3
- TASK-7 Connect the temporary parking pass → REQ-12, REQ-14, REQ-16; must pass AC-12.1, AC-12.2, AC-12.3, AC-14.1
- TASK-8 Connect the employee parking roster → REQ-2; must pass AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-2.5
- TASK-9 Connect entrance verification activity → REQ-15, REQ-16, REQ-17; must pass AC-15.1, AC-15.2, AC-15.3, AC-16.1, AC-16.2, AC-16.3, AC-16.4, AC-17.1, AC-17.2
- TASK-10 Connect the weekly utilization report → REQ-4, REQ-18, REQ-19, REQ-21; must pass AC-4.1, AC-19.1, AC-21.1
- TASK-11 Connect office parking settings → REQ-8, REQ-9, REQ-20; must pass AC-8.1, AC-8.2, AC-9.1, AC-9.2, AC-20.1, AC-20.2, AC-20.3
- TASK-12 Connect parking activity history → REQ-5, REQ-7, REQ-18, REQ-22; must pass AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-7.1, AC-7.2, AC-18.1, AC-18.2, AC-18.3, AC-22.1

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- GET /api/auth/google/authorization -> 200, 503
- POST /api/auth/sign-in -> 200, 400, 401, 503
- GET /api/employees/me -> 200, 401, 403, 404
- GET /api/parking/dashboard -> 200, 401
- POST /api/parking/releases/today -> 200, 401, 403, 409
- GET /api/vehicles -> 200, 401
- POST /api/vehicles -> 201, 400, 401, 409
- GET /api/parking/releases -> 200, 401
- POST /api/parking/releases -> 201, 400, 401, 403, 422
- DELETE /api/parking/releases/{releaseId} -> 200, 401, 403, 404, 409
- GET /api/parking/availability -> 200, 401
- POST /api/parking/claims -> 201, 400, 401, 403, 409, 422
- GET /api/parking/claims/today -> 200, 401, 404
- DELETE /api/parking/claims/{claimId} -> 200, 401, 403, 404, 409
- GET /api/admin/roster -> 200, 401, 403
- GET /api/admin/entry-checks -> 200, 401, 403
- POST /api/entrance/verify -> 200, 400, 503
- GET /api/admin/utilization -> 200, 400, 401, 403
- GET /api/admin/office-settings -> 200, 401, 403
- PUT /api/admin/office-settings -> 200, 400, 401, 403
- GET /api/admin/activity -> 200, 401, 403
- POST /api/notifications/availability -> 202, 400, 503

## Critic findings (2)
- [medium] REQ-16 AC-16.2 requires a guard-facing screen that displays the indicator result, conflicting with Q-8’s explicit instruction not to provide guards with a product screen.
- [medium] REQ-19 REQ-19 requires an overall utilization-percentage field but specifies no calculation formula, so the report’s percentage cannot be objectively validated.

## Settled by questions, and open risks
- Spec check: "The product shall be one responsive web app with layouts for phone, tablet, and desktop; pages shall avoid horizontal overflow at representative widths and narrow layouts shall use touch-sized controls." is in scope. The request asks for it: "The application will be available on both iOS and Android platforms."
- Spec question Q-9: Should all 22 requirements proceed together as one run, or should the scope be reduced? → Approve all 22 requirements as one run. (answered)
- Spec question Q-10: If an entrance check fails because the camera, plate recognition, network, or indicator is unavailable, should the vehicle be held for manual verification or denied entry until service is restored? → Deny entry until service is restored; do not provide a manual-verification path. (answered)
- Spec question Q-11: How should the app ensure an employee can access only their own profile and vehicle data? → Require the signed-in Folio3 Google identity to match the corporate email used to retrieve the profile, and restrict employee and vehicle data to that employee (with administrators retaining their authorized access). (answered)
- Spec question Q-12: If a permanent-sticker holder enters using a space that was released and allocated temporarily, what should happen to the temporary claimant’s authorization? → Treat the permanent holder’s detected entry as use of that space, cancel the temporary allocation, and deny the temporary claimant authorization for that space. (answered)

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

## Decide
  factory approve 20261013-folio3-parking-app-introductio-c0aa <hash> --note "your risk note"
  factory reject  20261013-folio3-parking-app-introductio-c0aa <hash> --reason "why"

Card hash: b72f52f0