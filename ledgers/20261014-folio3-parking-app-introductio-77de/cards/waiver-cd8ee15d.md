# Waive build gate? (author-tests)

Run 20261014-folio3-parking-app-introductio-77de these gates fail:

- tests.cover-every-criterion: AC-13.1: no test covers it (The linked test only renders office report-recipient settings, so add a test that processes an availability notification and asserts eligible recipients and the fixed-template email payload.)

A waiver is recorded with your name and reason. It covers these gates for this commit only; a different one needs a new decision.
To accept it as it stands:
  factory waive 20261014-folio3-parking-app-introductio-77de cd8ee15d --reason "why this is fine"
The test writer was sent back and still wrote no test for this criterion. Accepting locks the tests as they are and the build goes on; the pull request names the criteria. To stop instead: factory stop 20261014-folio3-parking-app-introductio-77de

Card hash: cd8ee15d