# Questions before the spec (round 1)

Run 20261012-folio3-parking-app-introductio-d447. Your request:
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

**Q-1** Who receives a push notification when a space becomes available, and what should happen if delivery fails or a recipient has notifications disabled?
  A. Notify all eligible employees without dedicated parking; availability remains claimable in the app even if a push notification is not delivered.   ← recommended: It preserves equal first-come access and keeps notification failure from blocking a claim.
  B. Notify eligible employees who have enabled push notifications; do not make notification delivery a condition of claiming.
  C. Notify a configured subset of eligible employees and make the space available to them before notifying others.
  (why it matters: Notification audience and delivery timing can affect who learns about and claims a space.)

**Q-2** What exact actions may Parking Administrators perform, especially when a holder's release has already been claimed and requires administrator intervention?
  A. Manage employee and parking records, configuration, and reports; also reverse a claimed release when needed, recording the intervention.   ← recommended: It gives meaning to the stated administrator-intervention path using the administrator role already named.
  B. Manage employee and parking records, configuration, and reports, but do not reverse claimed releases.
  C. Manage records and configuration only; a separate business owner approves claimed-release reversals.
  (why it matters: Determines who can change an already claimed allocation and its audit history.)

**Q-3** What application access, if any, does a Security Guard need for entrance verification and recording entry status?
  A. Provide a guard-facing view of verification results and a way to record whether the vehicle entered.   ← recommended: The request requires entry status to be recorded but does not otherwise define how the guard supplies it.
  B. The camera and indicator handle verification; guards use the existing process and do not access the app.
  C. Provide a guard-facing view of verification results, but record only the system's authorization result rather than actual entry.
  (why it matters: Determines what entry events are recorded and which staff can access verification information.)

**Q-4** Can an employee without dedicated parking claim more than one temporary space for the same date, and can they cancel or relinquish a claim before entry?
  A. Allow at most one claim per employee per date, with no user cancellation after a successful claim.   ← recommended: It establishes a minimal per-day limit and avoids adding an unrequested claim-reversal flow.
  B. Allow at most one claim per employee per date and let the employee cancel it until another user takes the space.
  C. Allow multiple claims per employee per date; do not provide user cancellation.
  (why it matters: Changes how many spaces an employee can consume and whether claimed allocations are freed.)

**Q-5** How should daily/weekly utilization and the overall utilization percentage be calculated, including the denominator and the treatment of released but unclaimed spaces?
  A. Define utilization as occupied spaces divided by total available spaces for each reporting period; report released and claimed totals separately and exclude released-but-unclaimed spaces from occupied counts.   ← recommended: It distinguishes actual detected use from release and claim activity, which the request reports separately.
  B. Define utilization as claimed spaces divided by total spaces, whether or not an entry was detected.
  C. Have the administrator choose the formula when configuring each report.
  (why it matters: The formula changes the reported utilization values used to assess parking usage.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): Which source determines whether a Folio3 account belongs to an authorized employee, and what should happen if that source is unavailable? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-2 (high risk, confirm on the approval card): If authentication succeeds but the employee profile cannot be found or retrieved, should the user be denied access or allowed into a limited setup flow? → assumed: Deny dashboard access and show that the employee profile could not be retrieved.
- ASM-3: How should a returning employee be routed if their vehicle profile is missing or incomplete? → assumed: Route them to vehicle registration until they have at least one license plate, then allow access to the dashboard.
- ASM-4 (high risk, confirm on the approval card): Which existing systems or records will supply employee, dedicated-parking, floor, sticker, and registered-vehicle information, and how current must those records stay? → assumed: Use the corporate directory for employee details and the current parking records for assignments and vehicles; refresh them when a user signs in and when an administrator updates them.
- ASM-5 (high risk, confirm on the approval card): Which existing employee, parking-assignment, vehicle, sticker, and floor records must be loaded before launch, and who will provide and validate them? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-6 (high risk, confirm on the approval card): How should simultaneous claims for the last available space be decided and shown to the losing claimant? → assumed: Award the space to the first claim that succeeds; reject later claims, show refreshed availability, and never allocate the same space twice.
- ASM-7 (high risk, confirm on the approval card): What plate formats and matching rules should be used when comparing registered plates with LPR readings, including spacing, letter case, and uncertain matches? → assumed: Normalize case and permitted spacing, then require an exact match; do not authorize uncertain or partial matches.
- ASM-8 (high risk, confirm on the approval card): What should happen when the LPR camera cannot read a plate or the plate cannot be verified? → assumed: Do not authorize entry, keep the indicator off, and record the attempt with an unreadable or unverifiable result and the available timestamp.
- ASM-9 (high risk, confirm on the approval card): Which camera/LPR and indicator system will provide plate reads and receive authorization results, and what is the required behavior if that connection or the app service is unavailable? → assumed: Use the designated entrance system; on service or connection failure, do not show green, alert security, and record the failure when service is restored.
- ASM-10 (high risk, confirm on the approval card): Does “up to 30 days” mean the next 30 calendar dates or 30 working days, and which timezone determines the release date and 8:00 AM release time? → assumed: Use calendar dates in the office's local timezone, including weekends and holidays; the 30-day window is inclusive of the next 30 dates.
- ASM-11 (high risk, confirm on the approval card): Which recipients, delivery format, and local send time are intended by “designated stakeholders” and “Monday morning” for the weekly report? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-12 (high risk, confirm on the approval card): How long must release, claim, entrance-verification, and utilization histories be retained, and who may view them? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-13: Should the mobile application launch in English only or support additional languages? → assumed: English only, left to right.

Answer with letters or your own words:
  factory answer 20261012-folio3-parking-app-introductio-d447 5fa56cd1 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: 5fa56cd1