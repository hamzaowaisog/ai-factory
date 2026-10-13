# Questions before the spec (round 2)

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

**Q-6** May employees add, update, or deactivate their registered vehicle details after first-time setup, or must changes be made by an administrator?
  A. Employees can manage their own vehicle records; administrators can also manage them.   ← recommended: The request supports one or more stored vehicles but does not explain how ordinary vehicle changes are kept current.
  B. Only Parking Administrators can create or change vehicle records.
  C. Employees can add vehicles, but only administrators can edit or deactivate them.
  (why it matters: Vehicle changes affect stored records and which plates can be authorized at the entrance.)

**Q-7** When a claimant has multiple registered vehicles, which plate should be authorized for that temporary parking claim?
  A. Require the employee to select one registered vehicle when claiming; authorize only that plate for the claim.   ← recommended: This associates one temporary space with one vehicle and avoids a single claim authorizing multiple vehicles.
  B. Authorize every registered vehicle on the claimant's profile for the same claim date.
  C. Have an administrator designate one vehicle as the employee's active parking vehicle.
  (why it matters: This determines which vehicles receive authorization to enter under a claim.)

**Q-8** How will entry events for stickered dedicated vehicles be captured for utilization, given that those vehicles bypass system verification?
  A. Have the LPR system record their plate-entry events without requiring authorization verification.   ← recommended: Dedicated-vehicle entry data is needed to distinguish unused allocations from holders who arrived, while preserving the existing sticker entry process.
  B. Use an existing access-control or entry system as the source of stickered-vehicle entry events.
  C. Do not capture stickered-vehicle entry events; report dedicated utilization only where entry data is available.
  (why it matters: This determines whether dedicated-parking usage can be recorded accurately and affects utilization reporting.)

Assumed unless you say otherwise:
- ASM-14 (high risk, confirm on the approval card): What are the authoritative sources and initial-load method for employee profiles, dedicated-parking assignments, floors, and any existing vehicle records? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-15 (high risk, confirm on the approval card): If Google authentication succeeds but the corporate employee profile cannot be found or retrieved, what should the employee experience be? → assumed: Do not open the dashboard; show a recoverable profile-retrieval error and allow retry or support contact.
- ASM-16: How should a returning user be routed if their required vehicle profile is now incomplete? → assumed: Show the dashboard, prompt for vehicle registration, and block vehicle-dependent actions until a plate is registered.
- ASM-17: Which dates count as operating days for dedicated releases and temporary claims, especially weekends and public holidays? → assumed: Use an administrator-maintained working-day and holiday calendar.
- ASM-18: If two employees try to claim the final available space at nearly the same time, what should the employee whose claim loses see? → assumed: Reject the later claim and show refreshed availability.
- ASM-19 (high risk, confirm on the approval card): What should happen when the entrance system cannot read a plate or cannot verify it against the day's authorization? → assumed: Do not activate the green indicator, record the attempt as unverified, and have the guard follow the existing non-system procedure.
- ASM-20 (high risk, confirm on the approval card): Which LPR camera and indicator-light equipment, vendor interfaces, and connectivity are to be integrated at the entrance? → assumed: Integrate Folio3's already selected camera and indicator using their vendor-supported interfaces; provide the device details.
- ASM-21 (high risk, confirm on the approval card): How should entrance verification behave if the camera, indicator, or connection to the authorization service is unavailable? → assumed: Fail closed for system authorization: do not show green, record the outage if possible, and have the guard follow the existing procedure.
- ASM-22: On what platform should the guard-facing verification view be provided? → assumed: A responsive web app for desktop and mobile browsers; no native apps unless the requirements name them.
- ASM-23: How should temporary claims be assigned to parking floors, and what capacity information must administrators maintain for each floor? → assumed: Administrators maintain floor capacities, and the system assigns each claim to the floor with the fewest current temporary allocations.
- ASM-24 (high risk, confirm on the approval card): When an administrator reverses a release that has already been claimed, what happens to the temporary claimant's authorization? → assumed: Administrators work in the same app on admin-only screens; no separate back office.
- ASM-25: How are the designated weekly-report stakeholders identified and maintained? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-26: What exact time and timezone should the weekly report use for its Monday-morning delivery? → assumed: Use a specified fixed time in the Folio3 office's local timezone.
- ASM-27: How should a dedicated space be classified in utilization reporting when its holder released it but it remained unclaimed and no vehicle entered? → assumed: Report it separately as released-but-unclaimed; do not classify it as unused dedicated parking.
- ASM-28 (high risk, confirm on the approval card): How long must verification attempts, release history, administrator interventions, and utilization events be retained, and who may review them? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-29: Which languages must the application and its notifications and reports support? → assumed: English only, left to right.
- ASM-30: What accessibility target should the mobile application and guard-facing view meet? → assumed: WCAG 2.1 AA on the main flows.

Answer with letters or your own words:
  factory answer 20261012-folio3-parking-app-introductio-d447 9a169a78 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 9a169a78