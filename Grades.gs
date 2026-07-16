function getGradeList() {
	return getSheetAsObjects('Grade');
}

function getGradeById(gradeId) {
	var grades = getSheetAsObjects('Grade');
	for (var i = 0; i < grades.length; i++) {
		if (grades[i]['會員等級ID'] === gradeId) {
			return grades[i];
		}
	}
	return null;
}

function getGradeIdByName(gradeName) {
	var grades = getSheetAsObjects('Grade');
	for (var i = 0; i < grades.length; i++) {
		if (grades[i]['會員等級名稱'] === gradeName) {
			return grades[i]['會員等級ID'];
		}
	}
	return null;
}
